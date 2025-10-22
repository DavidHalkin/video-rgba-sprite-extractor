const config_U = {
  frames: 2, // это именно кол-во кадров  которые надо взять из центра анимации
};

const U1 = {
  side_cycle: 191,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: {
      start: 2,
      duration: 38,
      // frames: "1,10,20,38",
    },
    cycle: {
      start: 42,
      duration: 51,
      // frames: "1-51x5",
    },
    end: {
      start: 94,
      duration: 29,
      // frames: [1, 15, 29],
    },
  },
  move: {
    start: {
      start: 124,
      duration: 7,
      // frames: [1],
    },
    cycle: {
      start: 132,
      duration: 33,
      // frames: "1-33x4",
    },
    end: {
      start: 166,
      duration: 25,
      // frames: [1, 25],
    },
  },
};

const U2 = {
  side_cycle: 190,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: {
      start: 2,
      duration: 19,
      // frames: "all",
    },
    cycle: {
      start: 22,
      duration: 45,
      // frames: "1-45x3",
    },
    end: {
      start: 68,
      duration: 56,
      // frames: [1, 20, 56],
    },
  },
  move: {
    start: {
      start: 125,
      duration: 6,
      // frames: [1],
    },
    cycle: {
      start: 132,
      duration: 33,
      // frames: "1-33x3",
    },
    end: {
      start: 166,
      duration: 25,
      // frames: [1, 25],
    },
  },
};

const U3 = {
  side_cycle: 190,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: {
      start: 2,
      duration: 15,
      // frames: "all",
    },
    cycle: {
      start: 18,
      duration: 49,
      // frames: "1-49x2",
    },
    end: {
      start: 69,
      duration: 48,
      // frames: [1, 24, 48],
    },
  },
  move: {
    start: {
      start: 118,
      duration: 13,
      // frames: [1, 13],
    },
    cycle: {
      start: 132,
      duration: 33,
      // frames: "1-33x3",
    },
    end: {
      start: 166,
      duration: 25,
      // frames: [1, 25],
    },
  },
};

const U4 = {
  side_cycle: 243,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: {
      start: 2,
      duration: 31,
      // frames: "1-31x2",
    },
    cycle: {
      start: 34,
      duration: 37,
      // frames: "1-37x2",
    },
    end: {
      start: 72,
      duration: 48,
      // frames: [1, 24, 48],
    },
  },
  move: {
    start: {
      start: 121,
      duration: 47,
      // frames: "1-47x4",
    },
    cycle: {
      start: 169,
      duration: 32,
      // frames: "1-32x2",
    },
    end: {
      start: 200,
      duration: 44,
      // frames: [1, 22, 44],
    },
  },
};

const U5 = {
  side_cycle: 243,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: {
      start: 2,
      duration: 31,
      // frames: "1-31x2",
    },
    cycle: {
      start: 34,
      duration: 37,
      // frames: "1-37x2",
    },
    end: {
      start: 72,
      duration: 48,
      // frames: [1, 24, 48],
    },
  },
  move: {
    start: {
      start: 121,
      duration: 47,
      // frames: "1-47x4",
    },
    cycle: {
      start: 169,
      duration: 32,
      // frames: "1-32x2",
    },
    end: {
      start: 200,
      duration: 44,
      // frames: [1, 22, 44],
    },
  },
};

const U6 = {
  side_cycle: 190,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: {
      start: 2,
      duration: 26,
      // frames: "all",
    },
    cycle: {
      start: 29,
      duration: 44,
      // frames: "1-44x4",
    },
    end: {
      start: 74,
      duration: 57,
      // frames: [1, 29, 57],
    },
  },
  move: {
    start: {
      start: 124,
      duration: 7,
      frames: [1],
    },
    cycle: {
      start: 132,
      duration: 33,
      // frames: "1-33x3",
    },
    end: {
      start: 166,
      duration: 25,
      // frames: [1, 25],
    },
  },
};

const U7 = {
  side_cycle: 1,
  idle: {
    start: 1,
    duration: 1,
    frames: "all",
  },
};

const U7_Battle = {
  side_cycle: 199,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  turn: {
    start: {
      start: 2,
      duration: 79,
    },
    // frames: "1-79x8",
  },
  attack: {
    start: 81,
    duration: 35,
    // frames: "1-35x5",
  },
  turn2: {
    start: {
      start: 117,
      duration: 83,
    },
    // frames: "1-83x8",
  },
};

const U8 = {
  side_cycle: 190,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: {
      start: 2,
      duration: 26,
      frames: 3,
    },
    cycle: {
      start: 29,
      duration: 37,
      frames: [28, 30, 36],
    },
    end: {
      start: 67,
      duration: 57,
      frames: 3,
    },
  },
  move: {
    start: {
      start: 124,
      duration: 7,
      frames: 4,
    },
    cycle: {
      start: 132,
      duration: 33,
      frames: 4,
    },
    end: {
      start: 166,
      duration: 25,
      frames: 4,
    },
  },
};

const U9 = {
  side_cycle: 243,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: {
      start: 2,
      duration: 25,
      // frames: "1-25x2",
    },
    cycle: {
      start: 28,
      duration: 35,
      // frames: "1-35x2",
    },
    end: {
      start: 64,
      duration: 56,
      // frames: [1, 28, 56],
    },
  },
  move: {
    start: {
      start: 121,
      duration: 39,
      // frames: "1-39x4",
    },
    cycle: {
      start: 169,
      duration: 30,
      // frames: "1-30x3",
    },
    end: {
      start: 200,
      duration: 44,
      // frames: [1, 22, 44],
    },
  },
};

const U10 = {
  side_cycle: 72,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  move: {
    start: {
      start: 2,
      duration: 10,
      // frames: "all",
    },
    cycle: {
      start: 13,
      duration: 47,
      // frames: "1-47x4",
    },
    end: {
      start: 61,
      duration: 11,
      // frames: [1, 11],
    },
  },
};

const U11 = {
  side_cycle: 249,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: {
      start: 2,
      duration: 248,
      frames: [5, 13, 29, 57, 70],
    },
  },
};

const U12 = {
  side_cycle: 249,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  move: {
    start: {
      start: 124,
      duration: 7,
      // frames: 4,
    },
    cycle: {
      start: 132,
      duration: 33,
      // frames: 4,
    },
    end: {
      start: 166,
      duration: 25,
      // frames: 4,
    },
  },
  attack: {
    start: 191,
    duration: 59,
    // frames: "1-10",
    frames: "4,7,10,15,20",
  },
};

const U13 = {
  side_cycle: 249,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  recharge: {
    start: {
      start: 2,
      duration: 26,
      // frames: "all",
    },
    cycle: {
      start: 29,
      duration: 44,
      // frames: "1-44x4",
    },
    end: {
      start: 74,
      duration: 57,
      // frames: [1, 29, 57],
    },
  },
  move: {
    start: {
      start: 124,
      duration: 7,
      frames: [1],
    },
    cycle: {
      start: 132,
      duration: 33,
      // frames: "1-33x3",
    },
    end: {
      start: 166,
      duration: 25,
      // frames: [1, 25],
    },
  },
  attack: {
    start: 191,
    duration: 59,
    // frames: "1-59x6",
  },
};

const U14 = {
  side_cycle: 139,
  idle: {
    start: 1,
    duration: 1,
    frames: [1],
  },
  attack: {
    start: 2,
    duration: 138,
    frames: [5, 13, 29, 57, 130],
  },
};

export {config_U, U1, U2, U3, U4, U5, U6, U7, U8, U9, U10, U11, U12, U13, U14, U7_Battle};
