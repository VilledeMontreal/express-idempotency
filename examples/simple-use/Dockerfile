FROM node:16

# Create app directory
WORKDIR /usr/src/app

# Copy the project
COPY . .

# Compile the library and link the library
RUN rm -rf node_modules dist && npm install && npm run compile && npm prune --production && npm link

# Installation of package to run the application
WORKDIR /usr/src/app/examples/simple-use

RUN rm -rf node_modules && npm link "express-idempotency" && npm install --production
# Force use of local library, npm link is not always working for some reasons
RUN npm install ../../.

EXPOSE 8080

# Run the application
WORKDIR /usr/src/app
CMD ["node", "--trace-deprecation", "./examples/simple-use/src/index.js"]

