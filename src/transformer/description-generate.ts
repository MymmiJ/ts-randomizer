import * as ts from 'typescript';
import { isEmpty, flatMap, map } from 'lodash/fp';

import {
  TypeArgumentsMap,
  PropertyType,
  TypeDescription,
  DescriptionFlag,
} from '../types';
import {
  isArrayType,
  getFirstTypeParameter,
  getTypeArguments,
  getPropertyNameBySyntaxKind,
  getTypeNameByWrapperFunction,
  createTypeArgumentsMap,
} from './utils';
import { getTypeChecker } from './checker';

type DescriptionFactory<T> = (
  node: T,
  typeArgumentsMap?: TypeArgumentsMap
) => TypeDescription;

const getEnumValues = (type: ts.Type) =>
  map(
    literal => (literal as ts.LiteralType).value,
    (type as ts.IntersectionType).types
  );

const getTurpleNodeDescription: DescriptionFactory<ts.TupleTypeNode> = (
  typeNode,
  typeArgumentsMap = {}
) => ({
  flag: DescriptionFlag.Turple,
  description: typeNode.elementTypes.map(i => ({
    description: generateNodeDescription(i, typeArgumentsMap),
  })),
});

const getPropertyDeclarationDescription: DescriptionFactory<ts.PropertyDeclaration> = (
  node,
  typeArgumentsMap = {}
) => {
  const checker = getTypeChecker();
  if (!node || !node.type) {
    return PropertyType.Null;
  }

  if (ts.isArrayTypeNode(node.type)) {
    const type = checker.getTypeAtLocation(node.type.elementType);
    const symbol = checker.getSymbolAtLocation(node.name);
    if (ts.isArrayTypeNode(node.type.elementType)) {
      return {
        key: symbol ? symbol.getName() : '',
        flag: DescriptionFlag.Array,
        description: generateNodeDescription(node.type, typeArgumentsMap),
      };
    }
    return {
      key: symbol ? symbol.getName() : '',
      flag: DescriptionFlag.Array,
      description: generatePropertyDescription(
        symbol ? symbol.getName() : '',
        type,
        typeArgumentsMap
      ),
    };
  }

  const symbol = checker.getSymbolAtLocation(node.name);
  const type = checker.getTypeAtLocation(node);

  if (!symbol) {
    return PropertyType.Null;
  }

  return (
    generateArrayTypeArgumentDescription(node, symbol, typeArgumentsMap) || {
      key: symbol.getName(),
      flag: ts.isArrayTypeNode(node.type) ? DescriptionFlag.Array : null,
      description: generatePropertyDescription(
        symbol.getName(),
        type,
        typeArgumentsMap
      ),
    }
  );
};

const getArrayTypeDescription: DescriptionFactory<ts.ArrayTypeNode> = (
  node,
  typeArgumentsMap = {}
) => {
  const checker = getTypeChecker();

  if (ts.isArrayTypeNode(node.elementType)) {
    return {
      flag: DescriptionFlag.Array,
      description: generateNodeDescription(node.elementType, typeArgumentsMap),
    };
  }

  const type = checker.getTypeFromTypeNode(node.elementType);
  if (isEmpty(typeArgumentsMap)) {
    return {
      flag: DescriptionFlag.Array,
      description: generatePropertyDescription(null, type, typeArgumentsMap),
    };
  }
  return generatePropertyDescription(null, type, typeArgumentsMap);
};

const getPropertySignatureDescription: DescriptionFactory<
  | ts.PropertySignature
  | ts.PropertyDeclaration
  | ts.MethodSignature
  | ts.MethodDeclaration
> = (node, typeArgumentsMap = {}) => {
  const checker = getTypeChecker();
  const symbol = checker.getSymbolAtLocation(node.name);

  if (!symbol || !node.type) {
    return PropertyType.Null;
  }

  if (ts.isMethodSignature(node) || ts.isMethodDeclaration(node)) {
    const type = checker.getTypeAtLocation(node.type as ts.TypeNode);
    return {
      key: symbol.getName(),
      flag: DescriptionFlag.Method,
      description: generatePropertyDescription(
        symbol.getName(),
        type,
        typeArgumentsMap
      ),
    };
  }

  // Return description with type node description
  if (node.type && ts.isTypeReferenceNode(node.type)) {
    const type = checker.getTypeAtLocation(node);
    return (
      generateArrayTypeArgumentDescription(node, symbol, typeArgumentsMap) || {
        key: symbol.getName(),
        flag: ts.isArrayTypeNode(node.type) ? DescriptionFlag.Array : null,
        description: generatePropertyDescription(
          symbol.getName(),
          type,
          typeArgumentsMap
        ),
      }
    );
  }

  // Return description for node if its name is array
  if (node.type && ts.isArrayTypeNode(node.type)) {
    const type = checker.getTypeAtLocation(node.type.elementType);
    if (ts.isArrayTypeNode(node.type.elementType)) {
      return {
        key: symbol.getName(),
        flag: DescriptionFlag.Array,
        description: generateNodeDescription(node.type, typeArgumentsMap),
      };
    }
    return {
      key: symbol.getName(),
      flag: DescriptionFlag.Array,
      description: generatePropertyDescription(
        symbol.getName(),
        type,
        typeArgumentsMap
      ),
    };
  }

  // Return basic type description
  return {
    key: symbol.getName(),
    description: getPropertyNameBySyntaxKind(node),
  };
};

const getTypeNodeDescription: DescriptionFactory<ts.TypeNode> = node => {
  const checker = getTypeChecker();
  const type = checker.getTypeFromTypeNode(node);
  const argsMap = createTypeArgumentsMap(type);
  return generatePropertyDescription(null, type, argsMap);
};

const mergeTypeArgumentsMaps = (
  argumentsMap: TypeArgumentsMap = {},
  nodeTypeArguments: TypeArgumentsMap = {},
  typeArgumentsMap: TypeArgumentsMap = {}
) => {
  const newArgumentsMap = isEmpty(argumentsMap)
    ? isEmpty(nodeTypeArguments) ||
      Object.keys(nodeTypeArguments).some(k => typeArgumentsMap[k])
      ? typeArgumentsMap
      : nodeTypeArguments
    : argumentsMap;

  Object.keys(newArgumentsMap).forEach(key => {
    const item = newArgumentsMap[key];
    const symbol = item.type.getSymbol();
    if (!symbol) {
      return;
    }
    const found =
      typeArgumentsMap[symbol.name] || nodeTypeArguments[symbol.name];
    if (found) {
      newArgumentsMap[key] = {
        isArray: item.isArray || found.isArray,
        type: found.type,
      };
      return;
    }
    getTypeArguments(item.type).forEach(i => {
      if (!i.symbol) {
        return;
      }
      const arr = getFirstTypeParameter(i);
      const symbolName = isArrayType(i)
        ? arr
          ? arr.symbol && arr.symbol.name
          : i.symbol.name
        : i.symbol.name;
      if (!symbolName) {
        return;
      }
      newArgumentsMap[symbolName] =
        typeArgumentsMap[symbolName] ||
        nodeTypeArguments[symbolName] ||
        newArgumentsMap[symbolName];
    });
  });

  return newArgumentsMap;
};

/**
 * Generate description for property declaration
 * @param node Property declarations
 * @param nodeTypeArguments Property type arguments relations map
 * @param typeArgumentsMap Parent node type arguments relations map
 */
const generateDeclarationDescription = (
  node: ts.PropertyDeclaration,
  nodeTypeArguments: TypeArgumentsMap = {},
  typeArgumentsMap: TypeArgumentsMap = {}
) => {
  const checker = getTypeChecker();

  if (!node) {
    return PropertyType.Unknown;
  }
  if (!node.type) {
    const key = node.name.getText();
    return {
      key,
      description: PropertyType.Unknown,
    };
  }

  if (ts.isTupleTypeNode(node.type)) {
    return getTurpleNodeDescription(node.type);
  }

  const nodeTypeNode = ts.isArrayTypeNode(node.type)
    ? node.type.elementType
    : node.type;

  const nodeType = checker.getTypeFromTypeNode(nodeTypeNode);
  const argumentsMap = createTypeArgumentsMap(nodeType);

  return generateNodeDescription(
    node,
    mergeTypeArgumentsMaps(argumentsMap, nodeTypeArguments, typeArgumentsMap)
  );
};

/**
 * Generate description for array type argument
 * @param node Node
 * @param symbol Node symbol
 * @param typeArgumentsMap Node type arguments relations map
 */
const generateArrayTypeArgumentDescription = (
  node: ts.Node,
  symbol: ts.Symbol,
  typeArgumentsMap: TypeArgumentsMap = {}
) => {
  const checker = getTypeChecker();
  const type = checker.getTypeAtLocation(node);
  const isArrayNode = isArrayType(type);
  const isTypeArray = type.symbol
    ? typeArgumentsMap[type.symbol.name] &&
      typeArgumentsMap[type.symbol.name].isArray
    : false;
  const isArray = isArrayNode || isTypeArray;

  if (!isArray) {
    return;
  }

  const argumentType = isArrayNode
    ? getFirstTypeParameter(type)
    : typeArgumentsMap[type.symbol.name].type;

  return {
    key: symbol.getName(),
    flag: isArray ? DescriptionFlag.Array : null,
    description: generatePropertyDescription(
      symbol.getName(),
      argumentType || typeArgumentsMap[type.symbol.name].type,
      typeArgumentsMap
    ),
  };
};

/**
 * Generate property description
 * @param key Property key
 * @param type Type for description generation
 * @param typeArgumentsMap Node type arguments relations
 */
const generatePropertyDescription = (
  key: string | null,
  type: ts.Type,
  typeArgumentsMap: TypeArgumentsMap = {}
): TypeDescription => {
  const checker = getTypeChecker();
  if (!type) {
    return PropertyType.Unknown;
  }

  if (!type.symbol) {
    const typeNode = checker.typeToTypeNode(type);
    return getPropertyNameBySyntaxKind(typeNode);
  }

  const nameByWrapper = getTypeNameByWrapperFunction(type.symbol.name);

  if (nameByWrapper) {
    return nameByWrapper;
  }

  const arrayTypeParam = getFirstTypeParameter(type);
  if (isArrayType(type) && arrayTypeParam) {
    return {
      flag: DescriptionFlag.Array,
      description: generatePropertyDescription(
        key,
        arrayTypeParam,
        typeArgumentsMap
      ),
    };
  }

  const enumValues = getEnumValues(type);

  if (!isEmpty(enumValues)) {
    return {
      flag: DescriptionFlag.Enum,
      possibleValues: enumValues,
      description: [],
    };
  }

  const declarations = flatMap(
    p => p.declarations,
    checker.getPropertiesOfType(type)
  );

  if (!declarations.length) {
    const typeArg = typeArgumentsMap[type.symbol.name];
    const isArray = typeArg && typeArg.isArray;
    if (isArray) {
      return {
        flag: DescriptionFlag.Array,
        description: generatePropertyDescription(
          key,
          typeArg && typeArg.type,
          typeArgumentsMap
        ),
      };
    }
    return generatePropertyDescription(
      key,
      typeArg && typeArg.type,
      typeArgumentsMap
    );
  }

  const nodeTypeArguments = createTypeArgumentsMap(type);
  return flatMap(
    node =>
      generateDeclarationDescription(
        node as ts.PropertyDeclaration,
        nodeTypeArguments,
        typeArgumentsMap
      ),
    declarations
  );
};

/**
 * Generates description for node type
 * @param node Target node
 * @param typeArgumentsMap Node type arguments relations
 */
export const generateNodeDescription: DescriptionFactory<ts.Node> = (
  node,
  typeArgumentsMap = {}
) => {
  // Return description for array type node
  if (ts.isArrayTypeNode(node)) {
    return getArrayTypeDescription(node, typeArgumentsMap);
  }

  // Return description for turple type node
  if (ts.isTupleTypeNode(node)) {
    return getTurpleNodeDescription(node);
  }

  // Return description for type node
  if (ts.isTypeNode(node)) {
    return getTypeNodeDescription(node);
  }

  // Return property declaration and array of properties declarations description
  if (ts.isPropertyDeclaration(node)) {
    return getPropertyDeclarationDescription(node, typeArgumentsMap);
  }

  if (ts.isMethodSignature(node) || ts.isMethodDeclaration(node)) {
    return getPropertySignatureDescription(node, typeArgumentsMap);
  }

  // Then we need property signatures
  if (!ts.isPropertySignature(node)) {
    return PropertyType.Null;
  }

  return getPropertySignatureDescription(node, typeArgumentsMap);
};
