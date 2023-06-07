# http-fwd

HTTP Forwarder listen and forward request to 1 or more target hosts.

- Only Origin will be replaced with `TARGET_HOSTS` (e.g. https://http-fwd.nbs.dev replaced with https://my-backend.nbs.dev)
- Request Path, Headers and Body will be forwarded to all target hosts
- Configure `RESPONSE` by:
  - Always return http status `200`, `400`, `404`, `500` and `503`, or
  - `await-fwd` to wait for first failed request (fallback to last success forward) will be sent as response
- Supported HTTP Method
  - GET
  - POST
  - PUT
  - PATCH
  - DELETE
  - OPTIONS

## Usage

1. Create `.env` file, set `TARGET_HOSTS`
2. Start server
    ```shell
    docker run --rm -p 3000:3000 --env-file=.env nbsdev/http-fwd
    ```

## Contributors

<a href="https://github.com/nbs-nodejs/http-fwd/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nbs-nodejs/http-fwd" alt="contributors" />
</a>