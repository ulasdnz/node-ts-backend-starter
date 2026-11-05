import type { Query } from 'mongoose';
import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

type SortDirection = 1 | -1;
export type SortOrder = Record<string, SortDirection>;

const PAGE_INVALID = { message: 'validation.page_invalid' };
const LIMIT_INVALID = { message: 'validation.limit_invalid' };

export const paginationSchema = z.object({
  page: z.coerce.number(PAGE_INVALID).int(PAGE_INVALID).min(1, PAGE_INVALID).default(1),
  limit: z.coerce
    .number(LIMIT_INVALID)
    .int(LIMIT_INVALID)
    .min(1, LIMIT_INVALID)
    .max(MAX_PAGE_SIZE, LIMIT_INVALID)
    .default(DEFAULT_PAGE_SIZE),
  // A comma-separated list of fields, each optionally prefixed with '-' for descending order
  sort: z.string().trim().max(200, { message: 'validation.sort_invalid' }).optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface PaginateOptions {
  /** Fields a client may sort by. Anything else in the sort parameter is ignored. */
  allowedSortFields: readonly string[];
  /** Used when the client asks for no allowed field. */
  defaultSort?: SortOrder;
}

/**
 * Turns `"name,-createdAt"` into `{ name: 1, createdAt: -1, _id: -1 }`. Documents with equal values
 * in every sort key come back in no particular order, so a walk over the pages could skip or repeat
 * them. The unique `_id` as the last key makes the order total.
 */
export const parseSort = (
  sort: string | undefined,
  allowedFields: readonly string[],
  defaultSort: SortOrder,
): SortOrder => {
  const requested = (sort ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token): [string, SortDirection] =>
      token.startsWith('-') ? [token.slice(1), -1] : [token, 1],
    )
    .filter(([field]) => allowedFields.includes(field));

  const keys = requested.length > 0 ? requested : Object.entries(defaultSort);
  const order: SortOrder = Object.fromEntries(keys);
  order._id ??= keys.at(-1)?.[1] ?? 1;
  return order;
};

/** The document type a find query resolves to. */
type QueryDocument<TQuery> = TQuery extends Query<Array<infer TDoc>, unknown> ? TDoc : never;

/**
 * One page of what a find query matches, with the total number of matches. The query carries the
 * filter and options such as withDeleted(); the page and the count both run on a copy of it, so
 * they always agree. Ordering is paginate's job: the query itself is not sorted.
 */
export const paginate = async <TQuery extends Query<unknown[], unknown>>(
  query: TQuery,
  { page, limit, sort }: PaginationInput,
  { allowedSortFields, defaultSort = { _id: -1 } }: PaginateOptions,
): Promise<Page<QueryDocument<TQuery>>> => {
  const [data, total] = await Promise.all([
    query
      .clone()
      .sort(parseSort(sort, allowedSortFields, defaultSort))
      .skip((page - 1) * limit)
      .limit(limit)
      .exec(),
    query.clone().countDocuments().exec(),
  ]);

  return {
    // exec() on a generic query is typed by the constraint; the documents are the query's own
    data: data as QueryDocument<TQuery>[],
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};
