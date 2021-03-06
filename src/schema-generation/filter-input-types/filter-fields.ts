import { GraphQLInputType, GraphQLList, GraphQLNonNull } from 'graphql';
import { isArray } from 'util';
import { Field, TypeKind } from '../../model';
import {
    BinaryOperationQueryNode, BinaryOperator, ConstBoolQueryNode, CountQueryNode, LiteralQueryNode, QueryNode,
    TransformListQueryNode, VariableQueryNode
} from '../../query-tree';
import {
    AND_FILTER_FIELD, INPUT_FIELD_EVERY, INPUT_FIELD_NONE, FILTER_FIELD_PREFIX_SEPARATOR, OR_FILTER_FIELD
} from '../../schema/constants';
import { AnyValue, decapitalize, PlainObject } from '../../utils/utils';
import { createFieldNode } from '../field-nodes';
import { TypedInputFieldBase } from '../typed-input-object-type';
import { OPERATORS_WITH_LIST_OPERAND } from './constants';
import { FilterObjectType } from './generator';
import * as pluralize from 'pluralize';

export interface FilterField extends TypedInputFieldBase<FilterField> {
    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode
}

export class ScalarOrEnumFieldFilterField implements FilterField {
    public readonly inputType: GraphQLInputType;

    constructor(
        public readonly field: Field,
        public readonly resolveOperator: (fieldNode: QueryNode, valueNode: QueryNode) => QueryNode,
        public readonly operatorPrefix: string | undefined,
        baseInputType: GraphQLInputType
    ) {
        this.inputType = OPERATORS_WITH_LIST_OPERAND.includes(operatorPrefix || '') ? new GraphQLList(new GraphQLNonNull(baseInputType)) : baseInputType;
    }

    get name() {
        if (this.operatorPrefix == undefined) {
            return this.field.name;
        }
        return this.field.name + FILTER_FIELD_PREFIX_SEPARATOR + this.operatorPrefix;
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        const valueNode = createFieldNode(this.field, sourceNode);
        const literalNode = new LiteralQueryNode(filterValue);
        return this.resolveOperator(valueNode, literalNode);
    }
}

export class ScalarOrEnumFilterField implements FilterField {
    public readonly inputType: GraphQLInputType;

    constructor(
        public readonly resolveOperator: (fieldNode: QueryNode, valueNode: QueryNode) => QueryNode,
        public readonly operatorName: string,
        baseInputType: GraphQLInputType
    ) {
        this.inputType = OPERATORS_WITH_LIST_OPERAND.includes(operatorName) ? new GraphQLList(new GraphQLNonNull(baseInputType)) : baseInputType;
    }

    get name() {
        return this.operatorName;
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        const literalNode = new LiteralQueryNode(filterValue);
        return this.resolveOperator(sourceNode, literalNode);
    }
}

export class QuantifierFilterField implements FilterField {
    readonly name: string;

    constructor(
        public readonly field: Field,
        public readonly quantifierName: string,
        public readonly inputType: FilterObjectType
    ) {
        this.name = `${this.field.name}_${this.quantifierName}`;
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        const listNode = createFieldNode(this.field, sourceNode);

        // every(P(x)) === none(!P(x))
        const quantifierForResult = this.quantifierName === INPUT_FIELD_EVERY ? INPUT_FIELD_NONE : this.quantifierName;
        const filterValueForResult = this.quantifierName === INPUT_FIELD_EVERY ? {not: filterValue} : filterValue;

        const itemVariable = new VariableQueryNode(decapitalize(this.field.name));
        const filterNode = this.inputType.getFilterNode(itemVariable, filterValueForResult);
        const filteredListNode = new TransformListQueryNode({
            listNode,
            filterNode,
            itemVariable
        });

        return new BinaryOperationQueryNode(new CountQueryNode(filteredListNode),
            quantifierForResult === 'none' ? BinaryOperator.EQUAL : BinaryOperator.GREATER_THAN, new LiteralQueryNode(0));

    }
}

export class NestedObjectFilterField implements FilterField {
    readonly name: string;
    readonly description: string;

    constructor(
        public readonly field: Field,
        public readonly inputType: FilterObjectType
    ) {
        this.name = this.field.name;
        this.description = `Checks if \`${this.field.name}\` is not null, and allows to filter based on its fields.`;
        if(this.field.isReference && this.field.type.kind == TypeKind.ROOT_ENTITY && this.field.type.keyField){
            this.description = `Filters the through \`${this.field.type.keyField.name}\` referenced ${pluralize(this.field.type.name)} that fulfills the given requirements.\n\n ` + this.description;
        }
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        return this.inputType.getFilterNode(createFieldNode(this.field, sourceNode), filterValue);
    }
}

export class EntityExtensionFilterField implements FilterField {
    readonly name: string;
    readonly description: string;

    constructor(
        public readonly field: Field,
        public readonly inputType: FilterObjectType
    ) {
        this.name = this.field.name;
        this.description = `Allows to filter on the fields of \`${this.field.name}\`.\n\nNote that \`${this.field.name}\` is an entity extension and thus can never be \`null\`, so specifying \`null\` to this filter field has no effect.`;
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        if (filterValue == undefined) {
            // entity extensions can't ever be null, and null is always coerced to {}, so this filter just shouldn't have any effect
            return ConstBoolQueryNode.TRUE;
        }
        return this.inputType.getFilterNode(createFieldNode(this.field, sourceNode), filterValue);
    }
}

export interface ListFilterField extends FilterField {
    readonly inputType: FilterObjectType
    readonly field: Field
}

export class AndFilterField implements FilterField {
    readonly name: string;
    readonly description: string;
    readonly inputType: GraphQLInputType;

    constructor(
        public readonly filterType: FilterObjectType) {
        this.name = AND_FILTER_FIELD;
        this.description = `A field that checks if all filters in the list apply\n\nIf the list is empty, this filter applies to all objects.`;
        this.inputType = new GraphQLList(new GraphQLNonNull(filterType.getInputType()));
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        if (!isArray(filterValue) || !filterValue.length) {
            return new ConstBoolQueryNode(true);
        }
        const values = (filterValue || []) as ReadonlyArray<PlainObject>;
        const nodes = values.map(value => this.filterType.getFilterNode(sourceNode, value));
        return nodes.reduce((prev, node) => new BinaryOperationQueryNode(prev, BinaryOperator.AND, node));
    }
}

export class OrFilterField implements FilterField {
    public readonly name: string;
    public readonly description?: string;
    public readonly inputType: GraphQLInputType;

    constructor(
        public readonly filterType: FilterObjectType) {
        this.name = OR_FILTER_FIELD;
        this.description = `A field that checks if any of the filters in the list apply.\n\nIf the list is empty, this filter applies to no objects.\n\nNote that only the items in the list *or*-combined; this complete \`OR\` field is *and*-combined with outer fields in the parent filter type.`;
        this.inputType = new GraphQLList(new GraphQLNonNull(filterType.getInputType()));
    }

    getFilterNode(sourceNode: QueryNode, filterValue: AnyValue): QueryNode {
        if (!isArray(filterValue)) {
            return new ConstBoolQueryNode(true); // regard as omitted
        }
        const values = filterValue as ReadonlyArray<PlainObject>;
        if (!values.length) {
            return ConstBoolQueryNode.FALSE; // neutral element of OR
        }
        const nodes = values.map(value => this.filterType.getFilterNode(sourceNode, value));
        return nodes.reduce((prev, node) => new BinaryOperationQueryNode(prev, BinaryOperator.OR, node));
    }
}
