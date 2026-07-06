const PARTY = {
  Liberal: { color: '#c81a26', bg: '#fdecec' },
  Conservative: { color: '#1a4782', bg: '#e9eff8' },
  NDP: { color: '#d95d10', bg: '#fdf0e6' },
  'Bloc Québécois': { color: '#0f7fa3', bg: '#e6f4f9' },
  Bloc: { color: '#0f7fa3', bg: '#e6f4f9' },
  Green: { color: '#3d7a35', bg: '#ebf4ea' },
  Independent: { color: '#5b6472', bg: '#eef0f3' },
};

export const partyMeta = (party) => PARTY[party] || PARTY.Independent;
