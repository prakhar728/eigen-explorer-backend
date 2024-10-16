# EigenExplorer Node / Server Backend

This is the node/server backend for [EigenExplorer](https://eigenexplorer.com). EigenExplorer backend provides an array of API endpoints organized around REST for community users and developers to quickly access data and information about the Eigen Layer ecosystem.

Our API features predictable resource-oriented URLs, accepts form-encoded request bodies, returns JSON-encoded responses, and adheres to standard HTTP response codes, authentication methods, and verbs.

Currently, the API is free to use and open to the public. Please note that the API is currently in Beta and may be subject to change.

## Run Locally

The project is structured with multiple packages located in the packages directory, each serving a different purpose. Below are the steps to set up the project locally:

### 1. Set Up the Prisma Package

- Navigate to the [prisma directory](./packages/prisma/)
- Install dependencies
  ```
  npm install
  ```
- Create a .env file by copying the .env.example file and provide the URL of your local PostgreSQL database.
- Apply migrations with the following command:
  ```
  npx prisma migrate dev --name init
  ```

  The above command generates the prisma client as well, if not use: 
   ```
  npm run prisma:generate
  ```

### 2. Seed the Database

- Navigate to the [seeder directory](./packages/seeder/)
- Install dependencies
  ```
  npm install
  ```
- To seed the database tables with data, use the command:
  ```
  npm start
  ```
- Note: If this is too time/resource-consuming, you can manually add sample data to the tables for testing.

### 3. Start the API Server

- Navigate to the [api directory](./packages/api/)
- Install dependencies and 
  ```
  npm install
  ```
- Start the local server:
  ```
  npm start
  ```
- The API should now be accessible on your local machine.

### 4. Generate API Documentation (Optional)

- Navigate to the [openapi directory](./packages/openapi/)
- Update the openapi.json file and generate documentation:
  ```
  npm start
  ```
- You can refer to the EigenExplorer Docs repository (https://github.com/EigenExplorer/eigen-explorer-docs) for contributing to the API documentation.
## Contributing

Feel free to contribute to the project by opening an issue or submitting a pull request.
