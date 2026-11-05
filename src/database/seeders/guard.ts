const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface SeedTarget {
  nodeEnv: string;
  mongoUri: string;
  /** Set by `npm run seed -- --allow-remote`, for a database elsewhere that is meant for it. */
  allowRemote: boolean;
}

/**
 * The hosts a MongoDB connection string points at, credentials left out. An SRV string names a DNS
 * record rather than hosts, and always resolves to another machine.
 */
const hostsOf = (mongoUri: string): string[] | 'srv' => {
  if (mongoUri.startsWith('mongodb+srv://')) return 'srv';

  const authority = mongoUri.replace(/^mongodb:\/\//, '').split(/[/?]/)[0];
  const hostList = authority.slice(authority.lastIndexOf('@') + 1);
  return hostList
    .split(',')
    .map((host) =>
      host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0],
    )
    .map((host) => host.toLowerCase());
};

/**
 * Throws unless seeding, which deletes every user, may run against this database. NODE_ENV defaults
 * to development, so it cannot be the only guard: a production MONGO_URI in a local shell would pass
 * it. A database off this machine takes an explicit --allow-remote.
 */
export const assertSeedingAllowed = ({ nodeEnv, mongoUri, allowRemote }: SeedTarget): void => {
  if (nodeEnv === 'production') {
    throw new Error('Seeding deletes every user and is disabled in production');
  }
  if (allowRemote) return;

  const hosts = hostsOf(mongoUri);
  const remote =
    hosts === 'srv' ? ['an SRV record'] : hosts.filter((host) => !LOCAL_HOSTS.has(host));
  if (remote.length > 0) {
    throw new Error(
      `Seeding deletes every user, and MONGO_URI points at ${remote.join(', ')}, not this machine. ` +
        'If that database is meant for it, run: npm run seed -- --allow-remote',
    );
  }
};
