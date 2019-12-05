import * as ts from 'typescript';

export interface TypeArgumentsMap {
  [key: string]: { type: ts.Type; isArray?: boolean };
}

export enum PropertyType {
  Any = 'any',
  Boolean = 'boolean',
  Date = 'date',
  Function = 'function',
  Number = 'number',
  Object = 'object',
  String = 'string',
  Unknown = 'unknown',
  Null = 'null',
  Undefined = 'undefined',
}

export type TypeDescription =
  | PropertyDescription
  | PropertyType
  | Array<PropertyType | PropertyDescription>;

export interface PropertyDescription {
  key?: string;
  isArray?: boolean;
  type: TypeDescription;
}
