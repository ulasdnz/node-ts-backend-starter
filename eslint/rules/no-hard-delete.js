const FORBIDDEN_METHODS = new Set([
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findByIdAndDelete',
]);

const noHardDelete = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hard delete operations. Enforce soft delete policy.',
    },
    messages: {
      noHardDelete:
        'Hard delete ({{method}}) is not allowed. Use soft delete methods instead (e.g. softDeleteById, updateManyActive).',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (node.callee?.type !== 'MemberExpression') return;

        const property = node.callee.property;
        if (!property || property.type !== 'Identifier') return;

        const methodName = property.name;
        if (!FORBIDDEN_METHODS.has(methodName)) return;

        context.report({
          node,
          messageId: 'noHardDelete',
          data: { method: methodName },
        });
      },
    };
  },
};

export default noHardDelete;
