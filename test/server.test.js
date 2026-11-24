"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createStoreServer } = require("../server");

test("customer accounts can securely save and view only their orders", async (context) => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sonho-de-crianca-"),
  );
  const databasePath = path.join(temporaryDirectory, "loja.sqlite");
  const server = createStoreServer({ databasePath });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, cookie, headers = {}) =>
    fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /account-link.*Entrar/);

  const inaccessibleServerFile = await fetch(`${baseUrl}/server.js`);
  assert.equal(inaccessibleServerFile.status, 404);

  const anonymousOrders = await fetch(`${baseUrl}/api/orders`);
  assert.equal(anonymousOrders.status, 401);
  const anonymousFavorites = await fetch(`${baseUrl}/api/favorites`);
  assert.equal(anonymousFavorites.status, 401);

  const crossOriginRequest = await post(
    "/api/auth/register",
    {
      name: "Cliente Teste",
      email: "teste@example.com",
      phone: "(11) 99999-1234",
      password: "Senha-super-forte-123",
    },
    null,
    { Origin: "https://outro-site.example" },
  );
  assert.equal(crossOriginRequest.status, 403);

  const weakPassword = await post("/api/auth/register", {
    name: "Cliente Teste",
    email: "teste@example.com",
    phone: "12345",
    password: "123",
  });
  assert.equal(weakPassword.status, 400);

  const invalidPhone = await post("/api/auth/register", {
    name: "Cliente Teste",
    email: "teste@example.com",
    phone: "(11) 1234",
    password: "Senha-super-forte-123",
  });
  assert.equal(invalidPhone.status, 400);

  const registration = await post("/api/auth/register", {
    name: "Cliente Teste",
    email: "Teste@Example.com",
    phone: "(11) 99999-1234",
    password: "1111",
  });
  assert.equal(registration.status, 201);
  const registrationBody = await registration.json();
  assert.deepEqual(registrationBody.user, {
    id: 1,
    name: "Cliente Teste",
    email: "teste@example.com",
    phone: "11999991234",
  });
  assert.equal(JSON.stringify(registrationBody).includes("password"), false);

  const sessionCookie = registration.headers
    .get("set-cookie")
    .split(";")[0];
  assert.match(registration.headers.get("set-cookie"), /HttpOnly/);
  assert.match(registration.headers.get("set-cookie"), /SameSite=Lax/);

  const repeatedCharacterLogin = await post("/api/auth/login", {
    email: "teste@example.com",
    password: "1111",
  });
  assert.equal(repeatedCharacterLogin.status, 200);

  const currentUser = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal((await currentUser.json()).user.email, "teste@example.com");

  const duplicateRegistration = await post("/api/auth/register", {
    name: "Cliente Teste",
    email: "teste@example.com",
    phone: "(11) 98888-4321",
    password: "Outra-senha-segura-456",
  });
  assert.equal(duplicateRegistration.status, 409);

  const invalidOrder = await post(
    "/api/orders",
    { items: [{ name: "Produto inventado", quantity: 1 }] },
    sessionCookie,
  );
  assert.equal(invalidOrder.status, 400);

  const savedOrder = await post(
    "/api/orders",
    {
      items: [
        { name: "Caneca alça branca", quantity: 2 },
        { name: "Copo americano acrílico", quantity: 1 },
      ],
    },
    sessionCookie,
  );
  assert.equal(savedOrder.status, 201);
  const savedOrderBody = await savedOrder.json();
  assert.equal(savedOrderBody.order.totalCents, null);
  assert.equal(savedOrderBody.order.items.length, 2);
  assert.equal(savedOrderBody.order.items[0].unitPriceCents, 3000);
  assert.equal(savedOrderBody.order.items[1].unitPriceCents, null);

  const customerOrders = await fetch(`${baseUrl}/api/orders`, {
    headers: { Cookie: sessionCookie },
  });
  const customerOrdersBody = await customerOrders.json();
  assert.equal(customerOrdersBody.orders.length, 1);
  assert.equal(customerOrdersBody.orders[0].id, savedOrderBody.order.id);

  const secondCustomerRegistration = await post("/api/auth/register", {
    name: "Outra Cliente",
    email: "outra@example.com",
    phone: "(21) 98888-4321",
    password: "Outra-senha-segura-456",
  });
  assert.equal(secondCustomerRegistration.status, 201);
  const secondCustomerCookie = secondCustomerRegistration.headers
    .get("set-cookie")
    .split(";")[0];

  const addFavorite = await post(
    "/api/favorites",
    { productName: "Caneca alça branca" },
    sessionCookie,
  );
  assert.equal(addFavorite.status, 201);
  assert.equal((await addFavorite.json()).favorite.name, "Caneca alça branca");

  const duplicateFavorite = await post(
    "/api/favorites",
    { productName: "Caneca alça branca" },
    sessionCookie,
  );
  assert.equal(duplicateFavorite.status, 201);

  const invalidFavorite = await post(
    "/api/favorites",
    { productName: "Produto inventado" },
    sessionCookie,
  );
  assert.equal(invalidFavorite.status, 400);

  const customerFavorites = await fetch(`${baseUrl}/api/favorites`, {
    headers: { Cookie: sessionCookie },
  });
  assert.deepEqual(
    (await customerFavorites.json()).favorites.map(({ name }) => name),
    ["Caneca alça branca"],
  );

  const otherCustomerFavorites = await fetch(`${baseUrl}/api/favorites`, {
    headers: { Cookie: secondCustomerCookie },
  });
  assert.deepEqual((await otherCustomerFavorites.json()).favorites, []);

  const removeFavorite = await fetch(`${baseUrl}/api/favorites`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ productName: "Caneca alça branca" }),
  });
  assert.equal(removeFavorite.status, 200);
  const favoritesAfterRemoval = await fetch(`${baseUrl}/api/favorites`, {
    headers: { Cookie: sessionCookie },
  });
  assert.deepEqual((await favoritesAfterRemoval.json()).favorites, []);

  const secondCustomerOrders = await fetch(`${baseUrl}/api/orders`, {
    headers: { Cookie: secondCustomerCookie },
  });
  assert.deepEqual((await secondCustomerOrders.json()).orders, []);

  const logout = await post("/api/auth/logout", {}, sessionCookie);
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal((await afterLogout.json()).user, null);
});
