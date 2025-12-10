export function stdurl(url: string | URL): URL {
    try {
        url = new URL(url);
    } catch (err) {
        if (err instanceof TypeError) {
            url = new URL(String(self.location.origin).replace(/\/$/, '') + url);
        } else {
            throw err;
        }
    }

    return url;
}

/**
 * Standardize interactions with the backend API
 *
 * @param {URL|String} url      - Full URL or API fragment to request
 * @param {Object} [opts={}]    - Options
 */
export async function std(
    url: string | URL,
    opts: {
        token?: string;
        download?: boolean | string;
        headers?: Record<string, string>;
        body?: unknown;
        method?: string;
    } = {}
): Promise<unknown> {
    url = stdurl(url)
    if (!opts) opts = {};

    if (!opts.headers) opts.headers = {};

    if (!(opts.body instanceof FormData) && typeof opts.body === 'object' && !opts.headers['Content-Type']) {
        opts.body = JSON.stringify(opts.body);
        opts.headers['Content-Type'] = 'application/json';
    }

    if (localStorage.token && !opts.headers.Authorization) {
        opts.headers['Authorization'] = 'Bearer ' + localStorage.token;
    } else if (opts.token) {
        opts.headers['Authorization'] = 'Bearer ' + opts.token
    }

    const res = await fetch(url, opts as RequestInit);

    let bdy = {};
    if ((res.status < 200 || res.status >= 400) && ![401].includes(res.status)) {
        try {
            bdy = await res.json();
        } catch (err) {
            throw new Error(`Status Code: ${res.status}: ${err instanceof Error ? err.message : String(err)}`);
        }

        const errbody = bdy as { message: string };
        const err = new Error(errbody.message || `Status Code: ${res.status}`);
        // @ts-expect-error TODO Fix this
        err.body = bdy;
        throw err;
    } else if (res.status === 401) {
        delete localStorage.token;
        throw new Error('401');
    }

    const ContentType = res.headers.get('Content-Type');
    const ContentDisposition = res.headers.get('Content-Disposition');

    if (opts.download) {
        let name = 'download';
        if (typeof opts.download === 'string') {
            name = opts.download;
        } else if (ContentDisposition) {
            const regex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = regex.exec(ContentDisposition);
            if (matches && matches[1]) {
                name = matches[1].replace(/['"]/g, '');
            }
        }

        const object = new File([await res.blob()], name);
        const file = window.URL.createObjectURL(object);

        const link = document.createElement('a');
        link.href = file;
        link.download = name; // This is the magic attribute

        // Append to body, click, and then remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the blob URL to prevent memory leaks
        window.URL.revokeObjectURL(file);

        return res;
    } else if (ContentType && ContentType.includes('application/json')) {
        return await res.json();
    } else {
        return res;
    }
}
