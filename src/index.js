import express from "express";
import cors from "cors";
import { config } from "./config.js"
import { logger } from "./logger.js";
import http from "http";
import https from "https";

function main() {
    // Load config
    const targetHosts = initTargetHost(config.TARGET_HOSTS);
    const response = initResponse(config.RESPONSE);
    const forwardedHeaderMap = initForwardedHeaderMap(config.FORWARDED_HEADER);
    // Init server
    const app = express();
    // Init middlewares
    app.use(express.raw({ verify: handleGetRawBody, type: '*/*' }));
    // Set-up cors
    if (config.CORS_ORIGIN) {
        const corsMiddleware = cors({
            origin: config.CORS_ORIGIN,
            methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        })
        app.use(corsMiddleware)
        app.options('*', corsMiddleware)
        logger.debug(`CORS Enabled. Origin=${config.CORS_ORIGIN}`)
    }
    // Init forwarder handler
    app.all(/(.*)/, (req, res) => {
        // Preserve original header casing using rawHeaders
        const headers = {};
        const rawHeaders = req.rawHeaders || [];

        for (let i = 0; i < rawHeaders.length; i += 2) {
            const headerName = rawHeaders[i];
            const headerValue = rawHeaders[i + 1];

            // Skip reverse proxy headers
            const key = headerName.toLowerCase() 
            switch (key) {
                case 'host':
                case 'x-scheme':
                case 'x-forwarded-for':
                case 'x-forwarded-proto': {
                    continue;
                }
            }

            if (forwardedHeaderMap && !forwardedHeaderMap[key]) {
                continue
            }


            headers[headerName] = headerValue;
        }

        // Add custom header for forwarded IP
        if (!forwardedHeaderMap && req.headers["x-real-ip"]) {
            headers["x-fwd-from-ip"] = req.headers["x-real-ip"];
        }
        // Get request path
        const { method, originalUrl: path } = req
        // Get request body
        let body;
        if (method.toLowerCase() !== "get") {
            body = req.rawBody
        }
        // Send to target hosts
        Promise.all(
            targetHosts.map(async (host) => {
                return await forwardRequest({ method, host, path, headers, body })
            }))
            .then(fwdResults => {
                if (!response.awaitFwd) {
                    res.status(response.httpStatus)
                    res.send(response.body)
                    return
                }
                // Return error response, or fallback to success
                let fwdResp
                for (const item of fwdResults) {
                    // Skip if error on request
                    if (!item || !item.statusCode) {
                        continue
                    }
                    // Check if configured to return success response first
                    if (config.RETURNS_SUCCESS_FIRST && item.statusCode === 200) {
                        fwdResp = item
                        break
                    }
                    // Set error result and break
                    if (item.statusCode !== 200) {
                        fwdResp = item
                        break
                    }
                    // Set success response
                    fwdResp = item
                }
                // If fwdResp is still empty, then fallback
                if (!fwdResp) {
                    res.status(response.httpStatus)
                    res.send(response.body)
                    return
                }
                // Set status code
                res.status(fwdResp.statusCode)
                // Handle empty response body
                if (!fwdResp.rawBody || fwdResp.rawBody.length === 0) {
                    res.end()
                    return
                }
                // Override content type if exists
                if (fwdResp.headers["content-type"]) {
                    res.set("content-type", fwdResp.headers["content-type"])
                }
                res.send(fwdResp.rawBody)
            })
            .catch(err => {
                logger.error(`Failed to forward request. Error=${err}`)
                // If response has been sent, then skip
                if (res.headersSent) {
                    return
                }
                // Sent error response
                res.status(500)
                res.send({
                    code: "500",
                    message: "Internal Error",
                    data: {
                        _debug: {
                            error: err
                        }
                    }
                })
            })
    })
    // Start server
    app.listen(config.PORT, () => {
        logger.info(`Serving on http://localhost:${config.PORT}`);
        logger.info(`Response mode. AwaitForward=${response.awaitFwd} ReturnsSuccessFirst=${config.RETURNS_SUCCESS_FIRST}`)
    })
}

/**
 * Middleware to capture raw body from request buffer
 * @param req
 * @param res
 * @param {Buffer} buf
 * @param {"utf8"} encoding
 */
const handleGetRawBody = (req, res, buf, encoding) => {
    if (buf && buf.length) {
        req.rawBody = buf.toString(encoding || 'utf8');
    }
}

/**
 * Parse comma-separated urls and clean Target Host
 * @param str Raw string value from environment variable
 * @return {string[]} List of valid target host urls
 */
function initTargetHost(str) {
    if (!str) {
        logger.error("TARGET_HOST env is required");
        process.exit(1);
    }
    // Split string by comma
    const rawUrls = str.split(",");
    // Validate url
    /** @type {Set<string>} */
    const urls = new Set();
    for (const u of rawUrls) {
        try {
            const parsedUrl = new URL(u);
            urls.add(parsedUrl.origin);
        } catch (err) {
            logger.warn(`Invalid target host, cannot parse url. URL=${u}`);
        }
    }
    // Check if contains target urls
    if (urls.size < 1) {
        logger.error("TARGET_HOST env does not contains valid host URL");
        process.exit(2);
    }
    const arr = Array.from(urls)
    logger.debug(`Target Hosts = ${arr.join(", ")}`)
    return arr;
}

/**
 * Prepare response
 * @param str Config value
 * @return {{httpStatus: number, awaitFwd: boolean, body: {code: string, message: string}}}
 */
function initResponse(str) {
    const response = {}
    switch (str) {
        case "400": {
            response.body = {
                code: str,
                message: "Bad Request"
            }
            response.httpStatus = 400
            break
        }
        case "404": {
            response.body = {
                code: str,
                message: "Not Found"
            }
            response.httpStatus = 404
            break
        }
        case "500": {
            response.body = {
                code: str,
                message: "Internal Error"
            }
            response.httpStatus = 500
            break
        }
        case "503": {
            response.body = {
                code: str,
                message: "Service Unavailable"
            }
            response.httpStatus = 503
            break
        }
        default: {
            // Response: 200 OK
            response.body = {
                code: "200",
                message: "OK"
            }
            response.httpStatus = 200
            response.awaitFwd = str === "await-fwd"
        }
    }
    return response
}

function initForwardedHeaderMap(str) {
    if (!str) {
        return null;
    }

    // Split string by comma
    const rawHeaders = str.split(",");
    // Validate url
    const headerMap = {};
    for (const h of rawHeaders) {
        headerMap[h.toLowerCase()] = true;
    }
    logger.debug(`Forwarded Headers = ${JSON.stringify(headerMap)}`)
    return headerMap
}

async function forwardRequest({ host, path, method, headers, body }) {
    logger.debug(`Request to send. Method=${method} Host=${host} Path=${path} Headers=${JSON.stringify(headers)} Body=${body}`)
    // Clean up path
    if (!path.match(/^\//)) {
        path = "/" + path;
    } else {
        path = path.replace(/^\/+/, "/")
    }
    const u = `${host}${path}`

    return new Promise((resolve) => {
        try {
            const url = new URL(u);
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: method,
                headers: headers
            };

            logger.debug(`Sending request with headers: ${JSON.stringify(headers)}`);

            const req = httpModule.request(options, (res) => {
                let rawBody = '';

                res.on('data', (chunk) => {
                    rawBody += chunk;
                });

                res.on('end', () => {
                    const response = {
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: rawBody,
                        rawBody: rawBody,
                        url: u
                    };

                    logger.debug(`Got Response. Method=${method} URL=${u} HttpStatus=${res.statusCode} SentHeaders=${JSON.stringify(headers)} ResponseHeaders=${JSON.stringify(res.headers)} ResponseBody=${rawBody}`)
                    resolve(response);
                });
            });

            req.on('error', (err) => {
                logger.error(`Failed to Forward Request. Error=${err} TargetHost=${host}`)
                resolve(null);
            });

            if (body) {
                req.write(body);
            }

            req.end();
        } catch (err) {
            logger.error(`Failed to Forward Request. Error=${err} TargetHost=${host}`)
            resolve(null);
        }
    });
}
main();