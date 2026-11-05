/** Shape of a MongoDB server error such as E11000 duplicate key. */
export interface MongoError extends Error {
  code?: number;
  keyValue?: Record<string, unknown>;
  keyPattern?: Record<string, unknown>;
}
