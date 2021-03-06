import { GraphQLString } from 'graphql';
import { sortBy } from 'lodash';
import memorize from 'memorize-decorator';
import { FieldRequest } from '../graphql/query-distiller';
import { isListType } from '../graphql/schema-utils';
import { Field, ObjectType, Type, TypeKind } from '../model';
import {
    NullQueryNode, ObjectQueryNode, PropertySpecification, QueryNode, UnaryOperationQueryNode, UnaryOperator
} from '../query-tree';
import { CURSOR_FIELD, ID_FIELD, ORDER_BY_ASC_SUFFIX } from '../schema/constants';
import { getMetaFieldName } from '../schema/names';
import { flatMap } from '../utils/utils';
import { EnumTypeGenerator } from './enum-type-generator';
import { createFieldNode } from './field-nodes';
import { FilterAugmentation } from './filter-augmentation';
import { ListAugmentation } from './list-augmentation';
import { MetaTypeGenerator } from './meta-type-generator';
import { OrderByEnumGenerator, OrderByEnumType } from './order-by-enum-generator';
import {
    makeNonNullableList, QueryNodeField, QueryNodeNonNullType, QueryNodeOutputType
} from './query-node-object-type';
import { getOrderByValues } from './utils/pagination';

export class OutputTypeGenerator {
    constructor(
        private readonly listAugmentation: ListAugmentation,
        private readonly filterAugmentation: FilterAugmentation,
        private readonly enumTypeGenerator: EnumTypeGenerator,
        private readonly orderByEnumGenerator: OrderByEnumGenerator,
        private readonly metaTypeGenerator: MetaTypeGenerator
    ) {

    }

    generate(type: Type): QueryNodeOutputType {
        if (type.isObjectType) {
            return this.generateObjectType(type);
        }
        if (type.isScalarType) {
            return type.graphQLScalarType;
        }
        if (type.isEnumType) {
            return this.enumTypeGenerator.generate(type);
        }
        throw new Error(`Unsupported type kind: ${(type as Type).kind}`);
    }

    @memorize()
    private generateObjectType(objectType: ObjectType): QueryNodeOutputType {
        return {
            name: objectType.name,
            description: objectType.description,
            fields: () => this.getFields(objectType)
        };
    }

    private getFields(objectType: ObjectType): ReadonlyArray<QueryNodeField> {
        const origFields = [...objectType.fields];
        origFields.filter(field => field.isReference);

        const fields = flatMap(objectType.fields, field => {
            const nodeFields = this.createFields(field);
            if (field.isReference) {
                const type = field.type;
                if (type.kind === TypeKind.ROOT_ENTITY) {
                    nodeFields.forEach(nf => {
                        nf.description = (field.description ? field.description + '\n\n' : '') + 'This field references a `' + type.name + '` by its `' + (type.keyField ? type.keyField.name : 'key') + '` field';
                    });
                }
            }
            return nodeFields;
        });


        // include cursor fields in all types that could occur in lists
        const specialFields = objectType.isEntityExtensionType ? [] : [
            this.createCursorField(objectType)
        ];

        return [
            ...fields,
            ...specialFields
        ];
    }

    private createCursorField(objectType: ObjectType): QueryNodeField {
        const orderByType = this.orderByEnumGenerator.generate(objectType);
        return {
            name: CURSOR_FIELD,
            type: GraphQLString,
            description: `Provides a value that can be supplied to the \`after\` argument for pagination. Depends on the value of the \`orderBy\` argument.`,
            resolve: (source, args, info) => this.getCursorNode(source, info.fieldRequestStack[info.fieldRequestStack.length - 2], orderByType)
        };
    }

    private getCursorNode(itemNode: QueryNode, listFieldRequest: FieldRequest | undefined, orderByType: OrderByEnumType): QueryNode {
        if (!listFieldRequest || !isListType(listFieldRequest.field.type)) {
            return NullQueryNode.NULL;
        }

        // force the absolute-order-behavior we normally only have if the 'first' argument is present
        // so one can use a _cursor value from a query without orderBy as 'after' argument without orderBy.
        const clauses = getOrderByValues(listFieldRequest.args, orderByType, { forceAbsoluteOrder: true });
        const sortedClauses = sortBy(clauses, clause => clause.name);
        const objectNode = new ObjectQueryNode(sortedClauses.map(clause =>
            new PropertySpecification(clause.underscoreSeparatedPath, clause.getValueNode(itemNode))));
        return new UnaryOperationQueryNode(objectNode, UnaryOperator.JSON_STRINGIFY);
    }

    private createFields(field: Field): ReadonlyArray<QueryNodeField> {
        const type = this.generate(field.type);
        const schemaField: QueryNodeField = {
            name: field.name,
            type: field.isList ? makeNonNullableList(type) : type,
            description: field.description,
            resolve: (sourceNode) => createFieldNode(field, sourceNode)
        };

        if (field.isList && field.type.isObjectType) {
            return [
                this.listAugmentation.augment(schemaField, field.type),
                this.createMetaField(field)
            ];
        } else {
            return [schemaField];
        }
    }

    private createMetaField(field: Field): QueryNodeField {
        if (!field.type.isObjectType) {
            throw new Error(`Can only create meta field for object types`);
        }

        const metaType = this.metaTypeGenerator.generate();
        const plainField: QueryNodeField = {
            name: getMetaFieldName(field.name),
            type: new QueryNodeNonNullType(metaType),
            skipNullCheck: true, // meta fields should never be null
            description: field.description,
            resolve: (sourceNode) => createFieldNode(field, sourceNode)
        };
        return this.filterAugmentation.augment(plainField, field.type);
    }
}
