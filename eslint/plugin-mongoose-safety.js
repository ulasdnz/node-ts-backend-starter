import aggregatePolicy from './rules/aggregate-policy.js';
import noHardDelete from './rules/no-hard-delete.js';

const plugin = {
  meta: {
    name: 'mongoose-safety',
  },
  rules: {
    'aggregate-policy': aggregatePolicy,
    'no-hard-delete': noHardDelete,
  },
};

export default plugin;
