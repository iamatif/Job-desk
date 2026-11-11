import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyProfile,
  normaliseProfile,
  profileIssues,
  experienceYears,
  profilePlainText,
} from "../public/profile-data.js";
test("new profiles contain the account identity but no invented experience", () => {
  const p = emptyProfile({ name: "Jane", email: "jane@example.test" });
  assert.equal(p.name, "Jane");
  assert.equal(p.email, "jane@example.test");
  assert.equal(p.fictional, false);
  assert.equal(p.years, 0);
  assert.deepEqual(p.workHistory, []);
});
test("legacy profiles retain their work history when upgraded", () => {
  const p = normaliseProfile({
    name: "Alex",
    role: "CMS Developer",
    years: 2.5,
    skills: ["WordPress"],
    summary: "Summary",
    experience: "Original work history",
    portfolio: "",
    fictional: true,
  });
  assert.equal(p.legacyExperience, "Original work history");
  assert.match(profilePlainText(p), /Original work history/);
});
test("overlapping jobs are not double-counted", () => {
  assert.equal(
    experienceYears(
      [
        { startDate: "2022-01", endDate: "2024-01" },
        { startDate: "2023-01", endDate: "2025-01" },
      ],
      "2026-11-10",
    ),
    3,
  );
});
test("profile validation checks periods, URLs, and repeatable sections", () => {
  const p = emptyProfile({ name: "Jane" });
  p.role = "CMS Developer";
  p.skills = ["Shopify"];
  p.workHistory = [
    {
      id: "a",
      title: "Developer",
      company: "Studio",
      startDate: "2025-03",
      endDate: "2024-01",
      current: false,
      responsibilities: "Build stores",
    },
  ];
  assert.ok(profileIssues(p).some((e) => e.includes("end date")));
  p.workHistory[0].endDate = "2026-01";
  p.portfolio = "javascript:alert(1)";
  assert.ok(profileIssues(p).some((e) => e.includes("HTTPS")));
});
test("CV export includes editable credentials and achievements", () => {
  const p = emptyProfile({ name: "Jane" });
  p.certifications = [
    { name: "Shopify course", issuer: "Example Academy", issueDate: "2025" },
  ];
  p.awards = [
    {
      title: "Team award",
      issuer: "Studio",
      date: "2025-06",
      description: "Delivery quality",
    },
  ];
  const result = profilePlainText(p);
  assert.match(result, /Shopify course/);
  assert.match(result, /Team award/);
});

test('invalid rich date types are rejected without throwing',()=>{const p=emptyProfile({name:'Jane'});p.workHistory=[{id:'x',title:'Developer',company:'Studio',startDate:2024,endDate:'2025'}];assert.ok(profileIssues(p,{complete:false}).length);});
test('empty added entries require their identifying details',()=>{const p=emptyProfile({name:'Jane'});p.role='Developer';p.skills=['CMS'];p.certifications=[{id:'x',name:''}];assert.ok(profileIssues(p).some(e=>e.includes('certification name')));});
