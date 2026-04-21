import cf from '@openaddresses/cloudfriend';
import API from './lib/api.js';
import MQTT from './lib/mqtt.js';
import Secrets from './lib/secrets.js';

export default cf.merge(
    Secrets,
    MQTT,
    API,
    {
        Description: 'Template for CloudTAK-DJI',
        Parameters: {
            GitSha: {
                Description: 'GitSha that is currently being deployed',
                Type: 'String'
            },
            Environment: {
                Description: 'VPC/ECS Stack to deploy into',
                Type: 'String',
                Default: 'prod'
            },
            WorkspaceId: {
                Description: 'DJI Cloud API workspace_id handed back to DJI Pilot',
                Type: 'String',
                Default: 'default-workspace'
            },
            EnableExecute: {
                Description: 'Allow SSH into docker container - should only be enabled for limited debugging',
                Type: 'String',
                AllowedValues: ['true', 'false'],
                Default: 'false'
            }
        }
    },
);
