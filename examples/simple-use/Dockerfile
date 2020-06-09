FROM node:10

# Create app directory
WORKDIR /usr/src/app

# Copy the project
COPY . .

# Compile the library and link the library
RUN npm install && npm run compile && npm link

# Installation of package to run the application
RUN cd examples/simple-use && npm link "@villemontreal/express-idempotency" && npm install

EXPOSE 8080

# Run the application
CMD ["node", "./examples/simple-use/src/index.js"]

