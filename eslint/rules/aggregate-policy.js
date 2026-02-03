const SEARCH_STAGES = new Set(['$search', '$vectorSearch', '$searchMeta']);

function getStageName(objectExpression) {
  if (objectExpression.type !== 'ObjectExpression' || objectExpression.properties.length !== 1) {
    return null;
  }

  const prop = objectExpression.properties[0];
  if (prop.type !== 'Property') return null;

  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return prop.key.value;

  return null;
}

const aggregatePolicy = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce aggregateSafe usage to enforce soft delete policy',
    },
    messages: {
      noRawAggregate: 'Do not use aggregate(). Use aggregateSafe() to enforce soft delete policy.',

      searchStageWarning:
        'This aggregation uses {{stage}}. Soft delete cannot be enforced automatically. Ensure deleted filtering is handled explicitly.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (node.callee?.type !== 'MemberExpression') return;

        const methodName = node.callee.property?.name;
        if (!methodName) return;

        if (methodName === 'aggregate') {
          context.report({
            node,
            messageId: 'noRawAggregate',
          });
          return;
        }

        if (methodName !== 'aggregateSafe') return;

        const pipelineArg = node.arguments[0];
        if (!pipelineArg || pipelineArg.type !== 'ArrayExpression') return;

        for (const el of pipelineArg.elements) {
          if (!el) continue;

          const stageName = getStageName(el);

          if (!stageName) continue;

          if (SEARCH_STAGES.has(stageName)) {
            context.report({
              node: el,
              messageId: 'searchStageWarning',
              data: { stage: stageName },
            });
            return;
          }
        }
      },
    };
  },
};

export default aggregatePolicy;
