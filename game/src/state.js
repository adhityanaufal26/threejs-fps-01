// state.js — one place holds the whole match state. Every module reads and
// writes through this object; nothing keeps a second copy of a round fact.
export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  ROUND: 'round',
  ROUND_END: 'round_end',
  MATCH_END: 'match_end',
};

export const MATCH = {
  ROUNDS_TO_WIN: 5,
  MAX_ROUNDS: 9,
  ROUND_SECONDS: 100,
  BUY_SECONDS: 20,
  BOMB_FUSE_SECONDS: 30,
  PLANT_SECONDS: 3.0,
  DEFUSE_SECONDS: 4.0,
  START_MONEY: 800,
  KILL_REWARD: 300,
  PLANT_REWARD: 300,
  WIN_REWARD: 3250,
  LOSS_REWARD: 1900,
};

export function createState() {
  return {
    phase: PHASE.MENU,
    round: 1,
    scoreUs: 0,
    scoreThem: 0,
    money: MATCH.START_MONEY,
    roundTime: MATCH.ROUND_SECONDS,
    buyTime: MATCH.BUY_SECONDS,
    bombPlanted: false,
    bombSite: null,
    bombTimer: 0,
    bombPlantedBy: null,
    plantProgress: 0,
    defuseProgress: 0,
    defuser: null,
    roundWinner: null,
    roundReason: '',
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    time: 0,
    matchOver: false,
    // per-round reset helpers live here so a restart cannot forget a flag
    resetRound() {
      this.roundTime = MATCH.ROUND_SECONDS;
      this.bombPlanted = false;
      this.bombSite = null;
      this.bombTimer = 0;
      this.bombPlantedBy = null;
      this.plantProgress = 0;
      this.defuseProgress = 0;
      this.defuser = null;
      this.roundWinner = null;
      this.roundReason = '';
    },
  };
}
