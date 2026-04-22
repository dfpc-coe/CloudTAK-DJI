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
            DJIAppId: {
                Description: 'DJI Pilot Cloud API app_id (integer issued by DJI). Required for the controller web-view to verify its license and bring the Cloud Service online.',
                Type: 'Number',
                Default: 0
            },
            DJIAppKey: {
                Description: 'DJI Pilot Cloud API app_key issued alongside the app_id.',
                Type: 'String',
                Default: '',
                NoEcho: true
            },
            DJIAppLicense: {
                Description: 'DJI Pilot Cloud API license string issued by DJI for this app_id/app_key pair.',
                Type: 'String',
                Default: '',
                NoEcho: true
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
