import { GraphQLInt, GraphQLList, GraphQLNonNull, GraphQLString } from 'graphql';
import { Type } from '../model';
import {
    BinaryOperationQueryNode, BinaryOperator, ConstBoolQueryNode, LiteralQueryNode, OrderDirection, OrderSpecification,
    QueryNode, RuntimeErrorQueryNode, TransformListQueryNode, VariableQueryNode
} from '../query-tree';
import {
    AFTER_ARG, CURSOR_FIELD, FIRST_ARG, ID_FIELD, ORDER_BY_ARG, ORDER_BY_ASC_SUFFIX, SKIP_ARG
} from '../schema/constants';
import { decapitalize } from '../utils/utils';
import { OrderByEnumGenerator, OrderByEnumType, OrderByEnumValue } from './order-by-enum-generator';
import { QueryNodeField } from './query-node-object-type';
import { getOrderByValues } from './utils/pagination';

/**
 * Augments list fields with orderBy argument
 */
export class OrderByAndPaginationAugmentation {
    constructor(
        private readonly orderByEnumGenerator: OrderByEnumGenerator
    ) {
    }

    augment(schemaField: QueryNodeField, type: Type): QueryNodeField {
        if (!type.isObjectType) {
            return schemaField;
        }

        const orderByType = this.orderByEnumGenerator.generate(type);

        return {
            ...schemaField,
            args: {
                ...schemaField.args,
                [ORDER_BY_ARG]: {
                    type: new GraphQLList(new GraphQLNonNull(orderByType.getEnumType())),
                    description: `Specifies the how this ${type.isRootEntityType ? 'collection' : 'list'} should be sorted. If omitted, ` + (
                        type.isRootEntityType ? `the result order is not specified. ` : `the order of the list in the object is preserved. `
                    ) + (
                        type.isRootEntityType || type.isChildEntityType ?
                            `If pagination is used (i.e., the \`${FIRST_ARG}\` is specified), \`${ID_FIELD}${ORDER_BY_ASC_SUFFIX}\` will be implicitly added as last sort criterion so that the sort order is deterministic.` :
                            `When using cursor-based pagination, ensure that you specify a field with unique values so that the order is deterministic.`
                    )
                },
                [SKIP_ARG]: {
                    type: GraphQLInt,
                    description: `The number of items in the list or collection to skip. Is applied after the \`${AFTER_ARG}\` argument if both are specified.`
                },
                [FIRST_ARG]: {
                    type: GraphQLInt,
                    description: `The number of items to include in the result. If omitted, all remaining items will be included (which can cause performance problems on large collections).`
                },
                [AFTER_ARG]: {
                    type: GraphQLString,
                    description: `If this is set to the value of the \`${CURSOR_FIELD}\` field of an item, only items after that one will be included in the result. The value of the \`${AFTER_ARG}\` of this query must match the one where the \`${CURSOR_FIELD}\` value has been retrieved from.`
                }
            },
            resolve: (sourceNode, args, info) => {
                const listNode = schemaField.resolve(sourceNode, args, info);
                const itemVariable = new VariableQueryNode(decapitalize(type.name));

                const orderBy = this.getOrderSpecification(args, orderByType, itemVariable);
                const maxCount = args[FIRST_ARG];
                const skip = args[SKIP_ARG];
                const paginationFilter = this.createPaginationFilterNode(args, itemVariable, orderByType);

                if (orderBy.isUnordered() && maxCount == undefined && paginationFilter === ConstBoolQueryNode.TRUE) {
                    return listNode;
                }

                return new TransformListQueryNode({
                    listNode,
                    itemVariable,
                    orderBy,
                    skip,
                    maxCount,
                    filterNode: paginationFilter
                });
            }
        };
    };

    private getOrderSpecification(args: any, orderByType: OrderByEnumType, itemNode: QueryNode) {
        const mappedValues = getOrderByValues(args, orderByType);
        const clauses = mappedValues.map(value => value.getClause(itemNode));
        return new OrderSpecification(clauses);
    }

    private createPaginationFilterNode(args: any, itemNode: QueryNode, orderByType: OrderByEnumType) {
        const afterArg = args[AFTER_ARG];
        if (!afterArg) {
            return ConstBoolQueryNode.TRUE;
        }

        let cursorObj: any;
        try {
            cursorObj = JSON.parse(afterArg);
            if (typeof cursorObj != 'object' || cursorObj === null) {
                return new RuntimeErrorQueryNode('The JSON value provided as "after" argument is not an object');
            }
        } catch (e) {
            return new RuntimeErrorQueryNode(`Invalid cursor ${JSON.stringify(afterArg)} supplied to "after": ${e.message}`);
        }

        // Make sure we only select items after the cursor
        // Thus, we need to implement the 'comparator' based on the order-by-specification
        // Haskell-like pseudo-code because it's easier ;-)
        // filterForClause :: Clause[] -> FilterNode:
        // filterForClause([{field, ASC}, ...tail]) =
        //   (context[clause.field] > cursor[clause.field] || (context[clause.field] == cursor[clause.field] && filterForClause(tail))
        // filterForClause([{field, DESC}, ...tail]) =
        //   (context[clause.field] < cursor[clause.field] || (context[clause.field] == cursor[clause.field] && filterForClause(tail))
        // filterForClause([]) = FALSE # arbitrary; if order is absolute, this case should never occur
        function filterForClause(clauses: ReadonlyArray<OrderByEnumValue>): QueryNode {
            if (clauses.length == 0) {
                return new ConstBoolQueryNode(false);
            }

            const clause = clauses[0];
            const cursorProperty = clause.underscoreSeparatedPath;
            if (!(cursorProperty in cursorObj)) {
                return new RuntimeErrorQueryNode(`Invalid cursor supplied to "after": Property "${cursorProperty}" missing. Make sure this cursor has been obtained with the same orderBy clause.`);
            }
            const cursorValue = cursorObj[cursorProperty];
            const valueNode = clause.getValueNode(itemNode);

            const operator = clause.direction == OrderDirection.ASCENDING ? BinaryOperator.GREATER_THAN : BinaryOperator.LESS_THAN;
            return new BinaryOperationQueryNode(
                new BinaryOperationQueryNode(valueNode, operator, new LiteralQueryNode(cursorValue)),
                BinaryOperator.OR,
                new BinaryOperationQueryNode(
                    new BinaryOperationQueryNode(valueNode, BinaryOperator.EQUAL, new LiteralQueryNode(cursorValue)),
                    BinaryOperator.AND,
                    filterForClause(clauses.slice(1))
                )
            );
        }

        return filterForClause(getOrderByValues(args, orderByType));
    }
}
