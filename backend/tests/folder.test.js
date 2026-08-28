import request from "supertest";
import { app } from "../src/app.js";

describe("Folder API", () => {
  let token;

  beforeAll(async () => {
    const email = `folder_test_${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Folder Tester", email, password: "SecurePass123" });
    token = res.body.accessToken;
  });

  it("creates a root folder", async () => {
    const res = await request(app)
      .post("/api/folders")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Documents" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My Documents");
  });

  it("rejects creating a folder without auth", async () => {
    const res = await request(app).post("/api/folders").send({ name: "No Auth" });
    expect(res.status).toBe(401);
  });

  it("lists root folder contents", async () => {
    const res = await request(app)
      .get("/api/folders/root")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.children.folders.length).toBeGreaterThan(0);
  });
});