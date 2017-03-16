import detectQuoteStyle from '../utils/quote-style';
import { removeRequireAndImport } from '../utils/imports';
import logger from '../utils/logger';
import proxyquireTransformer from '../utils/proxyquire';

const matcherRenaming = {
    toExist: 'toBeTruthy',
    toNotExist: 'toBeFalsy',
    toNotBe: 'not.toBe',
    toNotEqual: 'not.toEqual',
    toNotThrow: 'not.toThrow',
    toBeA: 'toBeInstanceOf',
    toBeAn: 'toBeInstanceOf',
    toNotBeA: 'not.toBeInstanceOf',
    toNotBeAn: 'not.toBeInstanceOf',
    toNotMatch: 'not.toMatch',
    toBeFewerThan: 'toBeLessThan',
    toBeLessThanOrEqualTo: 'toBeLessThanOrEqual',
    toBeMoreThan: 'toBeGreaterThan',
    toBeGreaterThanOrEqualTo: 'toBeGreaterThanOrEqual',
    toInclude: 'toContain',
    toExclude: 'not.toContain',
    toNotContain: 'not.toContain',
    toNotInclude: 'not.toContain',
    toNotHaveBeenCalled: 'not.toHaveBeenCalled',
};

const matchersToBe = new Set([
    'toBeA',
    'toBeAn',
    'toNotBeA',
    'toNotBeAn',
]);

const matchersWithKey = new Set([
    'toContainKey',
    'toExcludeKey',
    'toIncludeKey',
    'toNotContainKey',
    'toNotIncludeKey',
]);

const matchersWithKeys = new Set([
    'toContainKeys',
    'toExcludeKeys',
    'toIncludeKeys',
    'toNotContainKeys',
    'toNotIncludeKeys',
]);

const jestMatchersWithNoArgs = new Set([
    'toBeTruthy',
    'toBeFalsy',
    'toHaveBeenCalled',
]);

export default function expectTransformer(fileInfo, api) {
    const j = api.jscodeshift;
    const ast = j(fileInfo.source);

    const expectFunctionName = removeRequireAndImport(j, ast, 'expect');

    if (!expectFunctionName) {
        // No expect require/import were found
        return fileInfo.source;
    }

    ast.find(j.MemberExpression, {
        object: {
            type: 'CallExpression',
            callee: { type: 'Identifier', name: expectFunctionName },
        },
        property: { type: 'Identifier' },
    })
    .forEach(path => {
        if (path.parentPath.parentPath.node.type === 'MemberExpression') {
            logger(fileInfo, 'Chaining except matchers is currently not supported', path);
            return;
        }

        path.parentPath.node.callee.object.callee.name = 'expect';
        const matcherNode = path.parentPath.node;
        const matcher = path.node.property;
        const matcherName = matcher.name;

        const matcherArgs = matcherNode.arguments;
        const expectArgs = path.node.object.arguments;

        const isNot = matcherName.indexOf('Not') !== -1 || matcherName.indexOf('Exclude') !== -1;

        if (matcherRenaming[matcherName]) {
            matcher.name = matcherRenaming[matcherName];
        }

        if (matchersToBe.has(matcherName)) {
            if (matcherArgs[0].type === 'Literal') {
                expectArgs[0] = j.unaryExpression('typeof', expectArgs[0]);
                matcher.name = isNot ? 'not.toBe' : 'toBe';
            }
        }

        if (matchersWithKey.has(matcherName)) {
            expectArgs[0] = j.template.expression`Object.keys(${expectArgs[0]})`;
            matcher.name = isNot ? 'not.toContain' : 'toContain';
        }

        if (matchersWithKeys.has(matcherName)) {
            const keys = matcherArgs[0];
            matcherArgs[0] = j.identifier('e');
            matcher.name = isNot ? 'not.toContain' : 'toContain';
            j(path.parentPath).replaceWith(j.template.expression`\
${keys}.forEach(e => {
  ${matcherNode}
})`);
        }

        if (matcherName === 'toMatch' || matcherName === 'toNotMatch') {
            const arg = matcherArgs[0];
            if (arg.type === 'ObjectExpression') {
                matcher.name = isNot ? 'not.toMatchObject' : 'toMatchObject';
            }
        }

        if (jestMatchersWithNoArgs.has(matcher.name)) {
            matcherNode.arguments = [];
        }

        if (matcherNode.arguments.length > 1) {
            const lastArg = matcherNode.arguments[matcherNode.arguments.length - 1];
            if (lastArg.type === 'Literal') {
                // Remove assertion message
                matcherNode.arguments.pop();
            }
        }
    });

    proxyquireTransformer(fileInfo, j, ast);

    const quote = detectQuoteStyle(j, ast) || 'single';
    return ast.toSource({ quote });
}
