import cf from '@openaddresses/cloudfriend';

/**
 * Auto-generated secrets used by the API and the MQTT broker.
 *
 *   ${StackName}/mqtt/password   - random password the broker accepts and the API uses
 *   ${StackName}/api/signing     - HS256 secret used to sign session JWTs
 */
export default {
  Resources: {
    MQTTPasswordSecret: {
        Type: 'AWS::SecretsManager::Secret',
        Properties: {
            Name: cf.join([cf.stackName, '/mqtt/password']),
            Description: cf.join([cf.stackName, ' MQTT broker password (auto-generated)']),
            GenerateSecretString: {
                ExcludePunctuation: true,
                PasswordLength: 32
            }
        }
    },
    APISigningSecret: {
        Type: 'AWS::SecretsManager::Secret',
        Properties: {
            Name: cf.join([cf.stackName, '/api/signing']),
            Description: cf.join([cf.stackName, ' JWT signing secret (auto-generated)']),
            GenerateSecretString: {
                ExcludePunctuation: true,
                PasswordLength: 64
            }
        }
    }
  }
};
