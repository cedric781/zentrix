import type { SupportedSport } from "@/lib/api/types";

type AliasMap = Record<string, string[]>;

const BASKETBALL_NBA: AliasMap = {
  "lakers": ["los angeles lakers", "la lakers", "l.a. lakers"],
  "celtics": ["boston celtics"],
  "warriors": ["golden state warriors", "gs warriors"],
  "nets": ["brooklyn nets"],
  "knicks": ["new york knicks", "ny knicks"],
  "76ers": ["philadelphia 76ers", "sixers", "philly"],
  "bucks": ["milwaukee bucks"],
  "heat": ["miami heat"],
  "bulls": ["chicago bulls"],
  "mavericks": ["dallas mavericks", "mavs"],
  "nuggets": ["denver nuggets"],
  "suns": ["phoenix suns"],
  "clippers": ["los angeles clippers", "la clippers"],
  "thunder": ["oklahoma city thunder", "okc thunder"],
  "rockets": ["houston rockets"],
  "kings": ["sacramento kings"],
  "spurs": ["san antonio spurs"],
  "trail blazers": ["portland trail blazers", "blazers"],
  "timberwolves": ["minnesota timberwolves", "wolves"],
  "pelicans": ["new orleans pelicans"],
  "grizzlies": ["memphis grizzlies"],
  "hawks": ["atlanta hawks"],
  "magic": ["orlando magic"],
  "wizards": ["washington wizards"],
  "hornets": ["charlotte hornets"],
  "pacers": ["indiana pacers"],
  "raptors": ["toronto raptors"],
  "cavaliers": ["cleveland cavaliers", "cavs"],
  "pistons": ["detroit pistons"],
  "jazz": ["utah jazz"],
};

const AMERICAN_FOOTBALL_NFL: AliasMap = {
  "patriots": ["new england patriots", "ne patriots"],
  "chiefs": ["kansas city chiefs", "kc chiefs"],
  "49ers": ["san francisco 49ers", "sf 49ers", "niners"],
  "eagles": ["philadelphia eagles"],
  "cowboys": ["dallas cowboys"],
  "bills": ["buffalo bills"],
  "ravens": ["baltimore ravens"],
  "dolphins": ["miami dolphins"],
  "jets": ["new york jets", "ny jets"],
  "steelers": ["pittsburgh steelers"],
  "bengals": ["cincinnati bengals"],
  "browns": ["cleveland browns"],
  "texans": ["houston texans"],
  "colts": ["indianapolis colts"],
  "jaguars": ["jacksonville jaguars", "jags"],
  "titans": ["tennessee titans"],
  "broncos": ["denver broncos"],
  "raiders": ["las vegas raiders", "lv raiders"],
  "chargers": ["los angeles chargers", "la chargers"],
  "lions": ["detroit lions"],
  "packers": ["green bay packers"],
  "vikings": ["minnesota vikings"],
  "bears": ["chicago bears"],
  "buccaneers": ["tampa bay buccaneers", "bucs"],
  "saints": ["new orleans saints"],
  "falcons": ["atlanta falcons"],
  "panthers": ["carolina panthers"],
  "rams": ["los angeles rams", "la rams"],
  "seahawks": ["seattle seahawks"],
  "cardinals": ["arizona cardinals"],
  "giants": ["new york giants", "ny giants"],
  "commanders": ["washington commanders"],
};

const FOOTBALL_EU: AliasMap = {
  "ajax": ["afc ajax", "ajax amsterdam"],
  "psv": ["psv eindhoven"],
  "feyenoord": ["feyenoord rotterdam"],
  "manchester united": ["man united", "man utd", "manchester utd"],
  "manchester city": ["man city", "man. city"],
  "liverpool": ["liverpool fc"],
  "chelsea": ["chelsea fc"],
  "arsenal": ["arsenal fc"],
  "tottenham": ["tottenham hotspur", "spurs"],
  "real madrid": ["real madrid cf"],
  "barcelona": ["fc barcelona", "barca"],
  "atletico madrid": ["atlético madrid", "atleti"],
  "bayern munich": ["fc bayern münchen", "bayern münchen", "fc bayern"],
  "borussia dortmund": ["bvb", "dortmund"],
  "juventus": ["juventus fc"],
  "inter milan": ["internazionale", "inter"],
  "ac milan": ["milan"],
  "psg": ["paris saint-germain", "paris sg"],
};

const ICE_HOCKEY_NHL: AliasMap = {
  "maple leafs": ["toronto maple leafs", "leafs"],
  "canadiens": ["montreal canadiens", "habs"],
  "bruins": ["boston bruins"],
  "rangers": ["new york rangers", "ny rangers"],
};

const BASEBALL_MLB: AliasMap = {
  "yankees": ["new york yankees", "ny yankees"],
  "red sox": ["boston red sox"],
  "dodgers": ["los angeles dodgers", "la dodgers"],
};

const TENNIS: AliasMap = {
  "novak djokovic": ["djokovic", "n. djokovic"],
  "carlos alcaraz": ["alcaraz", "c. alcaraz"],
  "rafael nadal": ["nadal", "r. nadal"],
  "iga swiatek": ["swiatek", "i. swiatek", "iga świątek"],
  "aryna sabalenka": ["sabalenka", "a. sabalenka"],
};

const MMA: AliasMap = {};

const SPORT_ALIASES: Record<SupportedSport, AliasMap> = {
  basketball: BASKETBALL_NBA,
  american_football: AMERICAN_FOOTBALL_NFL,
  football: FOOTBALL_EU,
  ice_hockey: ICE_HOCKEY_NHL,
  baseball: BASEBALL_MLB,
  tennis: TENNIS,
  mma: MMA,
};

export function normalizeTeamName(rawName: string, sport: SupportedSport): string | null {
  const needle = rawName.toLowerCase().trim();
  if (!needle) return null;

  const aliasMap = SPORT_ALIASES[sport];
  if (!aliasMap) return null;

  if (aliasMap[needle]) return needle;

  for (const [canonical, aliases] of Object.entries(aliasMap)) {
    if (aliases.some((a) => a.toLowerCase() === needle)) {
      return canonical;
    }
  }

  for (const canonical of Object.keys(aliasMap)) {
    if (canonical.length < 4) continue;
    if (needle.length < 4) continue;
    if (needle.includes(canonical) && (needle.length - canonical.length) <= canonical.length) {
      return canonical;
    }
    if (canonical.includes(needle) && (canonical.length - needle.length) <= needle.length) {
      return canonical;
    }
  }

  return null;
}

export function _addAliasForTesting(sport: SupportedSport, canonical: string, aliases: string[]): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("_addAliasForTesting only available in test env");
  }
  const map = SPORT_ALIASES[sport];
  if (!map[canonical]) {
    map[canonical] = [];
  }
  map[canonical].push(...aliases);
}
