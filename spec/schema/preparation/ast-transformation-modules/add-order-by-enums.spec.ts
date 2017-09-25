import {parse} from "graphql";
import {ENUM_TYPE_DEFINITION, INPUT_OBJECT_TYPE_DEFINITION} from "graphql/language/kinds";
import {AddFilterInputTypesTransformer} from "../../../../src/schema/preparation/ast-transformation-modules/add-filter-input-types";
import {getNamedInputTypeDefinitionAST, getNamedTypeDefinitionAST} from "../../../../src/schema/schema-utils";
import {AddOrderbyInputEnumsTransformer} from "../../../../src/schema/preparation/ast-transformation-modules/add-orderby-enums";

const sdl = `
            type Foo @entity {
                id: ID
                createdAt: DateTime
                updatedAt: DateTime
                foo: String!
                bar: Bar
            }
            
            type Bar @embedded {
                size: Int!
                name: String
            }
            
            scalar DateTime
            
            # the next three types are not defined in AST, yet. Normally, they are created along with a new GraphQLSchema. 
            scalar String
            scalar ID
            scalar Int

        `;

describe('add-order-by-enums', () => {
    it('meets preconditions', () => {
        const ast = parse(sdl);
        // there are no filter/input types before running the transformer.
        expect(ast.definitions.find(def => def.kind === ENUM_TYPE_DEFINITION)).toBeUndefined;
    });

    const ast = parse(sdl);
    new AddOrderbyInputEnumsTransformer().transform(ast);

    it ('contains an enum for Foo', () => {
        const fooOrderByEnum = getNamedTypeDefinitionAST(ast, 'FooOrderBy');
        expect(fooOrderByEnum).toBeDefined();
        expect(fooOrderByEnum.kind).toBe(ENUM_TYPE_DEFINITION);
        // TODO add more tests here.
    });

    it ('contains an enum for Bar', () => {
        const barOrderByEnum = getNamedTypeDefinitionAST(ast, 'BarOrderBy');
        expect(barOrderByEnum).toBeDefined();
        expect(barOrderByEnum.kind).toBe(ENUM_TYPE_DEFINITION);
        // TODO add more tests here.
    });

});
