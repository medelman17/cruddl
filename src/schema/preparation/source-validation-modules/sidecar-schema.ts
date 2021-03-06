import { ParsedProjectSource, ParsedProjectSourceBaseKind } from '../../../config/parsed-project';
import { ParsedSourceValidator } from '../ast-validator';
import { ValidationMessage } from '../../../model';
import ajv = require('ajv');

export class SidecarSchemaValidator implements ParsedSourceValidator {
    validate(source: ParsedProjectSource): ValidationMessage[] {
        if (source.kind != ParsedProjectSourceBaseKind.OBJECT ) {
            return [];
        }

        let data = source.object;

        const validate = ajv({
            allErrors: true
        }).compile(schemaJSON);
        if (validate(data) || !validate.errors) {
            return [];
        }

        return validate.errors.map((err): ValidationMessage => {
            const path = reformatPath(err.dataPath);
            if (path in source.pathLocationMap) {
                const loc = source.pathLocationMap[path];
                return ValidationMessage.error(err.message!,  loc);
            } else {
                return ValidationMessage.error(`${err.message} (at ${err.dataPath})`, undefined);
            }
        });
    }
}


function reformatPath(path: string) {
    return path
        .replace(/\.(\w+)/g, (_, name) => `/${name}`)
        .replace(/\[\'([^']*)\'\]/g, (_, name) => `/${name}`)
        .replace(/\[([^\]])*\]/g, (_, name) => `/${name}`);
}

// TODO: JSON Schema should be extracted into separate file
const schemaJSON = JSON.parse(`{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "description": "Sidecar file for schema definitions",
  "type": "object",
  "minProperties": 1,
  "additionalProperties": false,
  "properties": {
    "permissionProfiles": {
      "type": "object",
      "additionalProperties": false,
      "patternProperties": {
        "^[a-zA-Z0-9]+$": {
          "$ref": "#/definitions/PermissionProfile"
        }
      }
    },
    "i18n": {
      "type": "object",
      "additionalProperties": false,
      "patternProperties": {
        "^[a-zA-Z0-9_-]+$": {
          "$ref": "#/definitions/NamespaceLocalization"
        }
      }
    }
  },
  "definitions": {
    "PermissionProfile": {
      "type": "object",
      "required": [
        "permissions"
      ],
      "additionalProperties": false,
      "properties": {
        "permissions": {
          "type": "array",
          "minLength": 1,
          "items": {
            "$ref": "#/definitions/Permission"
          }
        }
      }
    },
    "Permission": {
      "type": "object",
      "required": [
        "roles",
        "access"
      ],
      "additionalProperties": false,
      "properties": {
        "roles": {
          "type": "array",
          "minLength": 1,
          "items": {
            "type": "string",
            "pattern": ".+"
          }
        },
        "access": {
          "type": "string",
          "enum": [
            "read",
            "readWrite"
          ]
        },
        "restrictToAccessGroups": {
          "type": "array",
          "minLength": 1,
          "items": {
            "type": "string",
            "pattern": ".+"
          }
        }
      }
    },
    "NamespaceLocalization": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "types": {
          "patternProperties": {
            "^[a-zA-Z0-9_]+$": {
              "$ref": "#/definitions/TypeLocalization"
            }
          }
        },
        "fields": {
          "patternProperties": {
            "^[a-zA-Z0-9_]+$": {
              "anyOf": [
                { "$ref": "#/definitions/FieldLocalization" },
                { "type": "string" }
              ]
            }
          }
        }
      }
    },
    "TypeLocalization": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "fields": {
          "patternProperties": {
            "^[a-zA-Z0-9_]+$": {
              "anyOf": [
                {
                  "$ref": "#/definitions/FieldLocalization"
                },
                {
                  "type": "string"
                }
              ]
            }
          }
        },
        "values": {
          "patternProperties": {
            "^[a-zA-Z0-9_]+$": {
              "anyOf": [
                {
                  "$ref": "#/definitions/EnumValueLocalization"
                },
                {
                  "type": "string"
                }
              ]
            }
          }
        },
        "label": {
          "type": "string"
        },
        "labelPlural": {
          "type": "string"
        },
        "hint": {
          "type": "string"
        }
      }
    },
    "FieldLocalization": {
      "properties": {
        "label": {
          "type": "string"
        },
        "hint": {
          "type": "string"
        }
      }
    },
    "EnumValueLocalization": {
      "properties": {
        "label": {
          "type": "string"
        },
        "hint": {
          "type": "string"
        }
      }
    }
  }
}
`);
