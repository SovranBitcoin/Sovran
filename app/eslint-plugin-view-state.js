/**
 * Local ESLint plugin: `view-state/no-jsx-loading-branch`.
 *
 * Bans rendering children behind a loading flag, `{isLoading && <Skeleton />}`
 * or `{query.isLoading && <Spinner />}`. Such a branch says what shows while
 * loading but not what replaces it, so empty, failed and refreshing screens
 * fall out of whichever other booleans happen to be checked. A `ViewState<T>`
 * rendered by `<StateSwitch>` (or a `SkeletonContentCrossfade`) makes every
 * state a branch.
 *
 * Only JSX children are checked, and only `&&` chains that end in JSX: a flag
 * passed as a value (`disabled={isLoading}`, `loading={isLoading && !data}`),
 * a negated flag (`!isLoading && …`) and a ternary with both branches are left
 * alone.
 */

const DEFAULT_NAMES = ['isLoading'];

function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'ChainExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function isLoadingFlag(node, names) {
  const target = unwrap(node);
  if (!target) return false;
  if (target.type === 'Identifier') return names.includes(target.name);
  if (target.type === 'MemberExpression' && !target.computed) {
    return target.property.type === 'Identifier' && names.includes(target.property.name);
  }
  return false;
}

function rendersJsx(node) {
  const target = unwrap(node);
  if (!target) return false;
  switch (target.type) {
    case 'JSXElement':
    case 'JSXFragment':
      return true;
    case 'ConditionalExpression':
      return rendersJsx(target.consequent) || rendersJsx(target.alternate);
    case 'LogicalExpression':
      return rendersJsx(target.right);
    default:
      return false;
  }
}

/** The operands of an `&&` tree, left to right (flattening both sides). */
function andOperands(node) {
  const target = unwrap(node);
  if (target && target.type === 'LogicalExpression' && target.operator === '&&') {
    return [...andOperands(target.left), ...andOperands(target.right)];
  }
  return [target];
}

const noJsxLoadingBranch = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Render async surfaces from a ViewState<T>, not a `{isLoading && …}` branch.',
    },
    schema: [
      {
        type: 'object',
        properties: { names: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      branch:
        'Do not render behind `{{flag}} && …`: it covers loading but not what replaces it. ' +
        'Derive a ViewState<T> (`toViewState` in @/shared/lib/viewState) and render it with ' +
        '<StateSwitch> (@/shared/ui/composed/StateSwitch), or use SkeletonContentCrossfade.',
    },
  },
  create(context) {
    const names = (context.options[0] && context.options[0].names) || DEFAULT_NAMES;
    const source = context.sourceCode || context.getSourceCode();
    return {
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (!parent || (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment')) return;
        const expression = unwrap(node.expression);
        if (!expression || expression.type !== 'LogicalExpression') return;
        if (expression.operator !== '&&') return;
        const operands = andOperands(expression);
        const rendered = operands[operands.length - 1];
        if (!rendersJsx(rendered)) return;
        const flag = operands.slice(0, -1).find((operand) => isLoadingFlag(operand, names));
        if (!flag) return;
        context.report({ node, messageId: 'branch', data: { flag: source.getText(flag) } });
      },
    };
  },
};

module.exports = {
  rules: { 'no-jsx-loading-branch': noJsxLoadingBranch },
};
