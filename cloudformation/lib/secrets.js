import cf from '@openaddresses/cloudfriend';

/**
 * Auto-generated secrets used by the API and AWS IoT Core custom authorizer.
 *
 *   ${StackName}/mqtt/password   - shared password accepted by the IoT Core custom authorizer
 *   ${StackName}/api/signing     - HS256 secret used to sign session JWTs
 */
export default {
  Resources: {
  MQTTPasswordSecret: {
    Type: 'AWS::SecretsManager::Secret',
    Properties: {
      Name: cf.join([cf.stackName, '/mqtt/password']),
      Description: cf.join([cf.stackName, ' AWS IoT Core custom authorizer password (auto-generated)']),
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
