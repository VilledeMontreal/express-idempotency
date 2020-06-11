# Basic use

This example demonstrate how to use the idempotency middleware.

## Quick start

In the `examples/simple-use` folder, in a terminal :

```bash
docker-compose build
docker-compose up
```

## Usage

The middleware is use on any express route and when calling http://localhost:8080, it will respond with the current date and time. But if you add a `Idempotency-Key` header, if will persist the response for the provided key and will return it for follwing request with the same key.

### Using VScode rest client extension

If you have the `VSCode Rest client` extension installed, you can use the `request.rest` file to test the middleware.

```
POST http://localhost:8080 HTTP/1.1
Content-Type: application/json
```

This will generate a new date and time for each call. But if you provide a `idempotency-key`, it will always serve the same response.

```
POST http://localhost:8080 HTTP/1.1
Content-Type: application/json
Idempotency-Key: 43f999b2-29e7-4190-892d-fc31be2a8e72
```

### Using curl

```bash
curl --request POST --url http://localhost:8080/ --header 'content-type: application/json'
```

and you can expect a result like this :

```bash
2020-06-11T14:35:59.424Z
```

But if you specify a idempotency key, it will persist the current date and time and should return always the same response.

```bash
curl --request POST --url http://localhost:8080/ --header 'content-type: application/json' --header 'idempotency-key: 454b8caf-fe16-4e80-a057-2c758b4e87ed'
```
