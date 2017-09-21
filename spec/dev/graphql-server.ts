import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as cors from 'cors';
import {graphqlExpress, graphiqlExpress} from "graphql-server-express";
import {GraphQLOptions} from 'graphql-server-core';
import {Server} from "http";
import {GraphQLSchema} from "graphql";

export interface GraphQLServerConfig {
    readonly port: number;
    readonly schema: GraphQLSchema;
}


export class GraphQLServer {

    private server: Server;

    constructor(private readonly config: GraphQLServerConfig) {
        const app = express();
        app.use(cors());
        app.get('/', (req, res) => { res.redirect('/graphiql')});
        app.use('/graphql', bodyParser.json(), graphqlExpress(() => this.getGraphQLOptions()));
        app.use('/graphiql', graphiqlExpress({endpointURL: '/graphql'}));
        this.server = app.listen(config.port, () => {
            console.log(`GraphQL server started on http://localhost:${config.port}.`);
        });
    }

    public stop() {
        if (this.server) {
            this.server.close();
            console.log('GraphQL server stopped.');
        }
    }

    private getGraphQLOptions(): GraphQLOptions {
        const schema = this.config.schema;
        if (!schema) {
            throw new Error('Give me a schema!');
        }
        return {
            schema,
            context: {} // unique token
        };
    }
}