// ============================================================================
// packages/core/src/tree-sitter/scm-queries.ts
//
// Aider-derived tree-sitter S-expression query strings for symbol extraction.
// Source: Aider's tree-sitter-languages queries (MIT license, Aider-AI/aider)
//
// Capture name conventions (from Aider):
//   @name.definition.{kind}  → symbol being defined (class, function, method, …)
//   @name.reference.{kind}   → symbol being referenced (call, class, type, …)
//
// Note: predicate operators like #strip!, #select-adjacent!, #set-adjacent!
// are Aider custom predicates and are silently ignored when not supported.
// ============================================================================

export const SCM_QUERIES: Record<string, string> = {
  typescript: `
(function_signature
  name: (identifier) @name.definition.function) @definition.function

(method_signature
  name: (property_identifier) @name.definition.method) @definition.method

(abstract_method_signature
  name: (property_identifier) @name.definition.method) @definition.method

(abstract_class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(module
  name: (identifier) @name.definition.module) @definition.module

(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(new_expression
  constructor: (identifier) @name.reference.class) @reference.class

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum
`,

  // tsx shares TypeScript grammar
  tsx: `
(function_signature
  name: (identifier) @name.definition.function) @definition.function

(method_signature
  name: (property_identifier) @name.definition.method) @definition.method

(abstract_class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(new_expression
  constructor: (identifier) @name.reference.class) @reference.class

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum
`,

  javascript: `
(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(class
  name: (_) @name.definition.class) @definition.class

(class_declaration
  name: (_) @name.definition.class) @definition.class

(function_expression
  name: (identifier) @name.definition.function) @definition.function

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(generator_function
  name: (identifier) @name.definition.function) @definition.function

(generator_function_declaration
  name: (identifier) @name.definition.function) @definition.function

(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)]) @definition.function)

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)]) @definition.function)

(assignment_expression
  left: (identifier) @name.definition.function
  right: [(arrow_function) (function_expression)]) @definition.function

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference.call)
  arguments: (_) @reference.call)

(new_expression
  constructor: (_) @name.reference.class) @reference.class
`,

  python: `
(class_definition
  name: (identifier) @name.definition.class) @definition.class

(function_definition
  name: (identifier) @name.definition.function) @definition.function

(call
  function: [
    (identifier) @name.reference.call
    (attribute
      attribute: (identifier) @name.reference.call)
  ]) @reference.call
`,

  go: `
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_declaration
  name: (field_identifier) @name.definition.method) @definition.method

(call_expression
  function: [
    (identifier) @name.reference.call
    (selector_expression field: (field_identifier) @name.reference.call)
  ]) @reference.call

(type_spec
  name: (type_identifier) @name.definition.type) @definition.type

(type_declaration (type_spec name: (type_identifier) @name.definition.interface type: (interface_type)))

(type_declaration (type_spec name: (type_identifier) @name.definition.class type: (struct_type)))

(const_declaration (const_spec name: (identifier) @name.definition.constant))
`,

  rust: `
(struct_item
  name: (type_identifier) @name.definition.class) @definition.class

(enum_item
  name: (type_identifier) @name.definition.class) @definition.class

(union_item
  name: (type_identifier) @name.definition.class) @definition.class

(type_item
  name: (type_identifier) @name.definition.class) @definition.class

(declaration_list
  (function_item
    name: (identifier) @name.definition.method) @definition.method)

(function_item
  name: (identifier) @name.definition.function) @definition.function

(trait_item
  name: (type_identifier) @name.definition.interface) @definition.interface

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (field_expression
    field: (field_identifier) @name.reference.call)) @reference.call
`,

  java: `
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

(method_declaration
  name: (identifier) @name.definition.method) @definition.method

(constructor_declaration
  name: (identifier) @name.definition.constructor) @definition.constructor

(field_declaration
  declarator: (variable_declarator
    name: (identifier) @name.definition.field)) @definition.field

(method_invocation
  name: (identifier) @name.reference.call) @reference.call

(object_creation_expression
  type: (type_identifier) @name.reference.class) @reference.class
`,
};
