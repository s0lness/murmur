/** Golden end-to-end scenarios. Each agent's utterance is distilled for real,
 *  then we assert the settlement contains (or excludes) specific structures.
 *  These encode the bugs we hit by hand so they can't regress silently. */
export interface EvalScenario {
  name: string;
  agents: { id: string; say: string }[];
  expect: {
    matches?: [string, string][]; // these two agents should pairwise-match
    groups?: string[][]; // each = agent ids that should land in one group buy
    rings?: string[][]; // each = agent ids forming a barter ring
    noMatch?: [string, string][]; // these must NOT connect
  };
}

export const SCENARIOS: EvalScenario[] = [
  {
    name: "tickets-group-buy",
    agents: [
      { id: "seller", say: "selling 8 tickets to Friday's concert, 40 each" },
      { id: "b1", say: "want a ticket to Friday's concert" },
      { id: "b2", say: "need a Friday concert ticket" },
      { id: "b3", say: "looking for a ticket to the concert on Friday" },
    ],
    expect: { groups: [["seller", "b1", "b2", "b3"]] },
  },
  {
    name: "barter-ring",
    agents: [
      { id: "g1", say: "I have Spider-Man on PS5 and want Forza" },
      { id: "g2", say: "I have Forza and want Call of Duty" },
      { id: "g3", say: "I have Call of Duty and want Spider-Man" },
    ],
    expect: { rings: [["g1", "g2", "g3"]] },
  },
  {
    name: "single-item-pairwise-not-group",
    agents: [
      { id: "seller", say: "selling my Nintendo Switch, around 200" },
      { id: "hi", say: "looking to buy a Nintendo Switch, up to 260" },
      { id: "lo", say: "want a Nintendo Switch, up to 230" },
    ],
    expect: { matches: [["seller", "hi"]] }, // one unit → best buyer, no group buy
  },
  {
    name: "ir-fallback-excludes",
    agents: [
      { id: "seller", say: "selling my Nintendo Switch, won't go below 200" },
      { id: "buyer", say: "want a Switch but I can already get one for 150 on eBay" },
    ],
    expect: { noMatch: [["seller", "buyer"]] },
  },
  {
    name: "substitute-match",
    agents: [
      { id: "seller", say: "selling a PS Vita, 120" },
      { id: "buyer", say: "want a Switch or a Vita, up to 200" },
    ],
    expect: { matches: [["seller", "buyer"]] },
  },
];
