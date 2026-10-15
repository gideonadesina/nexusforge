/**
 * Domain pack: Education (synthetic demonstration data).
 *
 * ALL records in this file are SYNTHETIC. No real person, school, document or
 * examination is represented. The engine that consumes this data knows nothing
 * about schools -- the vocabulary lives here, the reasoning does not.
 *
 * Edge direction rule (architecture 2.4):
 *   dependent  -[:DEPENDS_ON]->  dependency
 * so an impact traversal from a changed entity walks DEPENDS_ON *backwards*.
 */

export interface SeedSource {
  id: string;
  reference: string;
  excerpt: string;
  sourceType: string;
}

export interface SeedEntity {
  id: string;
  type: string;
  name: string;
  /** Reifies a relationship rather than being a standalone thing. */
  intermediary: boolean;
  /** Source ids that attest to this entity's existence. */
  sourceIds: string[];
}

export interface SeedDependency {
  /** Stable edge id, so re-seeding can MERGE rather than duplicate. */
  id: string;
  /** The entity that depends on something. */
  from: string;
  /** The entity it depends on. */
  to: string;
  /** Domain-pack flavour, never interpreted by the engine. */
  kind: string;
  /** Source attesting to this dependency. */
  sourceId: string;
}

export const DOMAIN = "education";

export const SOURCES: SeedSource[] = [
  {
    id: "src_resignation_okonkwo_2026_10_12",
    reference: "Resignation letter — A. Okonkwo — filed 2026-10-12, ref HR/RES/2026/41",
    excerpt:
      "I write to tender my resignation from my post as Physics teacher, effective Friday 16 October 2026.",
    sourceType: "resignation_letter",
  },
  {
    id: "src_staff_register_2026t1",
    reference: "Staff teaching register, Term 1 2026/2027, page 3",
    excerpt:
      "Okonkwo, A. — Physics — assigned SS2 Physics and SS3 Physics. Bello, F. — Chemistry, Physics (SS1 only).",
    sourceType: "staff_register",
  },
  {
    id: "src_timetable_2026t1",
    reference: "Master timetable, Term 1 2026/2027, revision 4",
    excerpt:
      "SS2 Physics — Mon P3 (Lab 1). SS3 Physics — Wed P1 (Lab 1). SS1 Physics — Thu P2 (Room 12).",
    sourceType: "timetable",
  },
  {
    id: "src_waec_mock_schedule_2026",
    reference: "WAEC mock examination schedule 2026/2027, issued 2026-09-28",
    excerpt:
      "Physics mock (theory and practical) scheduled 2026-11-09. Depends on completion of SS3 Physics syllabus and practical preparation.",
    sourceType: "exam_schedule",
  },
  {
    id: "src_lab_duty_roster_2026t1",
    reference: "Science laboratory duty roster, Term 1 2026/2027",
    excerpt:
      "Physics practical supervision and apparatus preparation — A. Okonkwo (primary). No named deputy recorded for Term 1.",
    sourceType: "duty_roster",
  },
  {
    id: "src_exam_cmte_minutes_2026_09",
    reference: "Examinations committee minutes, 2026-09-14, item 5",
    excerpt:
      "Science examinations coordination assigned to A. Okonkwo. The coordination role reports to, and draws its mandate from, the examinations committee.",
    sourceType: "committee_minutes",
  },
  {
    id: "src_pe_roster_2026t1",
    reference: "Physical education roster, Term 1 2026/2027",
    excerpt: "SS1 Physical Education and the athletics club — D. Danjuma.",
    sourceType: "duty_roster",
  },
];

export const ENTITIES: SeedEntity[] = [
  // --- people -------------------------------------------------------------
  {
    id: "ent_person_okonkwo",
    type: "Person",
    name: "A. Okonkwo (Physics teacher)",
    intermediary: false,
    sourceIds: ["src_staff_register_2026t1", "src_resignation_okonkwo_2026_10_12"],
  },
  {
    id: "ent_person_bello",
    type: "Person",
    name: "F. Bello (Chemistry teacher)",
    intermediary: false,
    sourceIds: ["src_staff_register_2026t1"],
  },
  {
    // DECOY: superficially similar (a teacher at the same school) but has no
    // dependency route to the resigning teacher.
    id: "ent_person_danjuma",
    type: "Person",
    name: "D. Danjuma (Physical Education teacher)",
    intermediary: false,
    sourceIds: ["src_pe_roster_2026t1"],
  },

  // --- assignments (intermediary: they reify person <-> duty) --------------
  {
    id: "ent_assign_physics_ss2",
    type: "Assignment",
    name: "Teaching assignment: SS2 Physics",
    intermediary: true,
    sourceIds: ["src_staff_register_2026t1"],
  },
  {
    id: "ent_assign_physics_ss3",
    type: "Assignment",
    name: "Teaching assignment: SS3 Physics",
    intermediary: true,
    sourceIds: ["src_staff_register_2026t1"],
  },
  {
    // DECOY chain: "Physics" in the name, but depends on Bello.
    id: "ent_assign_physics_ss1",
    type: "Assignment",
    name: "Teaching assignment: SS1 Physics",
    intermediary: true,
    sourceIds: ["src_staff_register_2026t1"],
  },
  {
    id: "ent_assign_pe_ss1",
    type: "Assignment",
    name: "Teaching assignment: SS1 Physical Education",
    intermediary: true,
    sourceIds: ["src_pe_roster_2026t1"],
  },

  // --- classes ------------------------------------------------------------
  {
    id: "ent_class_ss2_physics",
    type: "Class",
    name: "SS2 Physics",
    intermediary: false,
    sourceIds: ["src_timetable_2026t1"],
  },
  {
    id: "ent_class_ss3_physics",
    type: "Class",
    name: "SS3 Physics",
    intermediary: false,
    sourceIds: ["src_timetable_2026t1"],
  },
  {
    // DECOY: the word "Physics" appears, so keyword matching would wrongly
    // include it. The graph must exclude it: its only route is via Bello.
    id: "ent_class_ss1_physics",
    type: "Class",
    name: "SS1 Physics",
    intermediary: false,
    sourceIds: ["src_timetable_2026t1"],
  },

  // --- timetable slots ----------------------------------------------------
  {
    id: "ent_slot_mon_p3",
    type: "TimetableSlot",
    name: "Monday Period 3 — Lab 1",
    intermediary: false,
    sourceIds: ["src_timetable_2026t1"],
  },
  {
    id: "ent_slot_wed_p1",
    type: "TimetableSlot",
    name: "Wednesday Period 1 — Lab 1",
    intermediary: false,
    sourceIds: ["src_timetable_2026t1"],
  },

  // --- responsibilities ---------------------------------------------------
  {
    id: "ent_resp_lab_practical",
    type: "Responsibility",
    name: "Physics practical supervision and apparatus preparation",
    intermediary: false,
    sourceIds: ["src_lab_duty_roster_2026t1"],
  },
  {
    id: "ent_resp_exam_coordination",
    type: "Responsibility",
    name: "Science examinations coordination",
    intermediary: false,
    sourceIds: ["src_exam_cmte_minutes_2026_09"],
  },
  {
    // DECOY
    id: "ent_resp_athletics_club",
    type: "Responsibility",
    name: "Athletics club supervision",
    intermediary: false,
    sourceIds: ["src_pe_roster_2026t1"],
  },

  // --- governance ---------------------------------------------------------
  {
    id: "ent_committee_examinations",
    type: "Committee",
    name: "Examinations committee",
    intermediary: false,
    sourceIds: ["src_exam_cmte_minutes_2026_09"],
  },

  // --- examinations -------------------------------------------------------
  {
    id: "ent_exam_waec_mock_physics",
    type: "Examination",
    name: "WAEC Physics mock examination (2026-11-09)",
    intermediary: false,
    sourceIds: ["src_waec_mock_schedule_2026"],
  },
];

export const DEPENDENCIES: SeedDependency[] = [
  // Assignments depend on the person who holds them.
  {
    id: "dep_assign_ss2_on_okonkwo",
    from: "ent_assign_physics_ss2",
    to: "ent_person_okonkwo",
    kind: "staffed_by",
    sourceId: "src_staff_register_2026t1",
  },
  {
    id: "dep_assign_ss3_on_okonkwo",
    from: "ent_assign_physics_ss3",
    to: "ent_person_okonkwo",
    kind: "staffed_by",
    sourceId: "src_staff_register_2026t1",
  },

  // Classes depend on their teaching assignment.
  {
    id: "dep_class_ss2_on_assign",
    from: "ent_class_ss2_physics",
    to: "ent_assign_physics_ss2",
    kind: "taught_under",
    sourceId: "src_timetable_2026t1",
  },
  {
    id: "dep_class_ss3_on_assign",
    from: "ent_class_ss3_physics",
    to: "ent_assign_physics_ss3",
    kind: "taught_under",
    sourceId: "src_timetable_2026t1",
  },

  // Timetable slots depend on the assignment that fills them.
  {
    id: "dep_slot_mon_p3_on_assign_ss2",
    from: "ent_slot_mon_p3",
    to: "ent_assign_physics_ss2",
    kind: "scheduled_for",
    sourceId: "src_timetable_2026t1",
  },
  {
    id: "dep_slot_wed_p1_on_assign_ss3",
    from: "ent_slot_wed_p1",
    to: "ent_assign_physics_ss3",
    kind: "scheduled_for",
    sourceId: "src_timetable_2026t1",
  },

  // Lab practical supervision: TWO independent routes to the same person.
  // (a) directly rostered to the person, (b) tied to the SS3 assignment.
  // This is the deliberate multiple-path construction required by E4.
  {
    id: "dep_lab_on_okonkwo",
    from: "ent_resp_lab_practical",
    to: "ent_person_okonkwo",
    kind: "rostered_to",
    sourceId: "src_lab_duty_roster_2026t1",
  },
  {
    id: "dep_lab_on_assign_ss3",
    from: "ent_resp_lab_practical",
    to: "ent_assign_physics_ss3",
    kind: "attached_to",
    sourceId: "src_lab_duty_roster_2026t1",
  },

  // The mock exam depends on both the class and the practical preparation,
  // giving it three distinct routes to the resigning teacher.
  {
    id: "dep_exam_on_class_ss3",
    from: "ent_exam_waec_mock_physics",
    to: "ent_class_ss3_physics",
    kind: "requires_syllabus_completion",
    sourceId: "src_waec_mock_schedule_2026",
  },
  {
    id: "dep_exam_on_lab_practical",
    from: "ent_exam_waec_mock_physics",
    to: "ent_resp_lab_practical",
    kind: "requires_practical_preparation",
    sourceId: "src_waec_mock_schedule_2026",
  },

  // Governance cycle (deliberate, for E2):
  //   coordination -> committee -> coordination
  // The coordination role also depends on the person who performs it.
  {
    id: "dep_examcoord_on_okonkwo",
    from: "ent_resp_exam_coordination",
    to: "ent_person_okonkwo",
    kind: "performed_by",
    sourceId: "src_exam_cmte_minutes_2026_09",
  },
  {
    id: "dep_examcoord_on_committee",
    from: "ent_resp_exam_coordination",
    to: "ent_committee_examinations",
    kind: "mandated_by",
    sourceId: "src_exam_cmte_minutes_2026_09",
  },
  {
    id: "dep_committee_on_examcoord",
    from: "ent_committee_examinations",
    to: "ent_resp_exam_coordination",
    kind: "discharged_through",
    sourceId: "src_exam_cmte_minutes_2026_09",
  },

  // --- decoy subgraph: reachable vocabulary, no dependency route -----------
  {
    id: "dep_assign_ss1_on_bello",
    from: "ent_assign_physics_ss1",
    to: "ent_person_bello",
    kind: "staffed_by",
    sourceId: "src_staff_register_2026t1",
  },
  {
    id: "dep_class_ss1_on_assign",
    from: "ent_class_ss1_physics",
    to: "ent_assign_physics_ss1",
    kind: "taught_under",
    sourceId: "src_timetable_2026t1",
  },
  {
    id: "dep_assign_pe_on_danjuma",
    from: "ent_assign_pe_ss1",
    to: "ent_person_danjuma",
    kind: "staffed_by",
    sourceId: "src_pe_roster_2026t1",
  },
  {
    id: "dep_athletics_on_danjuma",
    from: "ent_resp_athletics_club",
    to: "ent_person_danjuma",
    kind: "rostered_to",
    sourceId: "src_pe_roster_2026t1",
  },
];

/** The entity whose change drives the Stage 1 demonstration scenario. */
export const SCENARIO_ROOT_ENTITY_ID = "ent_person_okonkwo";

/**
 * Entities that must NEVER appear in an impact analysis rooted at the
 * resigning teacher. Used by the decoy-exclusion test.
 */
export const DECOY_ENTITY_IDS = [
  "ent_class_ss1_physics",
  "ent_assign_physics_ss1",
  "ent_person_bello",
  "ent_person_danjuma",
  "ent_assign_pe_ss1",
  "ent_resp_athletics_club",
] as const;
