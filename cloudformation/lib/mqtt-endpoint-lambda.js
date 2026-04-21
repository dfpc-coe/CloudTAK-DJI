/* eslint-disable @typescript-eslint/no-require-imports */
/* global Buffer, exports, process, require */
'use strict';

const https = require('https');
const { IoTClient, DescribeEndpointCommand } = require('@aws-sdk/client-iot');

async function respond(event, context, status, data, physicalResourceId, reason) {
    const body = JSON.stringify({
        Status: status,
        Reason: reason || `See CloudWatch Logs: ${context.logStreamName}`,
        PhysicalResourceId: physicalResourceId || context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: data || {}
    });

    await new Promise((resolve, reject) => {
        const request = https.request(event.ResponseURL, {
            method: 'PUT',
            headers: {
                'content-type': '',
                'content-length': Buffer.byteLength(body)
            }
        }, (response) => {
            response.on('data', () => undefined);
            response.on('end', resolve);
        });

        request.on('error', reject);
        request.write(body);
        request.end();
    });
}

exports.handler = async (event, context) => {
    try {
        if (event.RequestType === 'Delete') {
            await respond(event, context, 'SUCCESS', {}, event.PhysicalResourceId);
            return;
        }

        const client = new IoTClient({ region: process.env.AWS_REGION });
        const endpoint = await client.send(new DescribeEndpointCommand({ endpointType: 'iot:Data-ATS' }));

        await respond(event, context, 'SUCCESS', {
            EndpointAddress: endpoint.endpointAddress
        }, endpoint.endpointAddress);
    } catch (err) {
        await respond(event, context, 'FAILED', {}, event.PhysicalResourceId, err instanceof Error ? err.message : String(err));
    }
};