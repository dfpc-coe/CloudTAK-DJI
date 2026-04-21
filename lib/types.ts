import { Type } from '@sinclair/typebox'

export const StandardResponse = Type.Object({
    status: Type.Integer(),
    message: Type.String()
});

/**
 * Subset of the CloudTAK login/profile response that we proxy through.
 * Keep this loose so upstream additions do not break us.
 */
export const CloudTAKLoginRes = Type.Object({
    email: Type.String(),
    access: Type.String()
});

export const CloudTAKLoginCreate = Type.Object({
    username: Type.String(),
    password: Type.String()
});

export const CloudTAKLoginCreateRes = Type.Object({
    token: Type.String(),
    access: Type.Optional(Type.String()),
    email: Type.Optional(Type.String())
});

export const CloudTAKConfigLoginRes = Type.Object({
    name: Type.Optional(Type.String()),
    logo: Type.Optional(Type.String()),
    forgot: Type.Optional(Type.String()),
    signup: Type.Optional(Type.String())
});

/* ---------------- DJI Cloud API canonical request/response shapes ---------------- */

export const DJIIamLoginReq = Type.Object({
    username: Type.String(),
    password: Type.String(),
    flag: Type.Optional(Type.Integer())
});

export const DJIIamLoginRes = Type.Object({
    code: Type.Integer(),
    message: Type.String(),
    data: Type.Optional(Type.Object({
        access_token: Type.String(),
        refresh_token: Type.Optional(Type.String()),
        user_id: Type.String(),
        username: Type.String(),
        workspace_id: Type.String(),
        mqtt_username: Type.String(),
        mqtt_password: Type.String(),
        mqtt_addr: Type.String()
    }))
});

export const DJIDevice = Type.Object({
    sn: Type.String(),
    callsign: Type.Optional(Type.String()),
    type: Type.Union([
        Type.Literal('aircraft'),
        Type.Literal('gateway'),
        Type.Literal('dock')
    ]),
    model: Type.Optional(Type.String()),
    online: Type.Boolean(),
    last_seen: Type.Optional(Type.String()),
    osd: Type.Optional(Type.Any()),
    livestream: Type.Optional(Type.Object({
        url: Type.Optional(Type.String()),
        kind: Type.Optional(Type.String()),
        active: Type.Boolean()
    }))
});
