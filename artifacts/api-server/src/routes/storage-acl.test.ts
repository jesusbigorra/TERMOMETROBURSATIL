import assert from "node:assert/strict";
import { test } from "node:test";
import { canAccessObject, ObjectPermission } from "../lib/objectAcl.ts";

function objectFileWithPolicy(policy?: object) {
  return {
    getMetadata: async () => [{
      metadata: policy ? { "custom:aclPolicy": JSON.stringify(policy) } : {},
    }],
  };
}

test("objetos privados sin ACL no se sirven y el propietario sí puede leer los finalizados", async () => {
  const pending = objectFileWithPolicy();
  const privateOwned = objectFileWithPolicy({ owner: "owner-1", visibility: "private" });
  const publicProduct = objectFileWithPolicy({ owner: "owner-1", visibility: "public" });

  assert.equal(await canAccessObject({
    objectFile: pending as never,
    requestedPermission: ObjectPermission.READ,
  }), false);
  assert.equal(await canAccessObject({
    userId: "owner-1",
    objectFile: privateOwned as never,
    requestedPermission: ObjectPermission.READ,
  }), true);
  assert.equal(await canAccessObject({
    userId: "other-user",
    objectFile: privateOwned as never,
    requestedPermission: ObjectPermission.READ,
  }), false);
  assert.equal(await canAccessObject({
    objectFile: publicProduct as never,
    requestedPermission: ObjectPermission.READ,
  }), true);
});