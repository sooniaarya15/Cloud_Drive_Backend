import request from "supertest";
import { app } from "../src/app.js";

describe("Auth API", () => {
  const testUser = {
    name: "Test User",
    email: `test_${Date.now()}@example.com`,
    password: "SecurePass123",
  };

  it("registers a new user", async () => {
    const res = await request(app).post("/api/auth/register").send(testUser);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(testUser.email);
    expect(res.body.accessToken).toBeDefined();
  });

  it("rejects duplicate email registration", async () => {
    await request(app).post("/api/auth/register").send(testUser);
    const res = await request(app).post("/api/auth/register").send(testUser);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_EMAIL");
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: testUser.password,
    });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it("rejects login with wrong password", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: "WrongPassword",
    });
    expect(res.status).toBe(401);
  });

  it("rejects /me without a token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});