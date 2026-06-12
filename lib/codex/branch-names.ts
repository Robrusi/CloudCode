const BRANCH_CITIES = [
  "abu-dhabi",
  "accra",
  "adelaide",
  "alexandria",
  "algiers",
  "amsterdam",
  "ankara",
  "antwerp",
  "athens",
  "atlanta",
  "auckland",
  "austin",
  "baltimore",
  "barcelona",
  "bangkok",
  "beijing",
  "beirut",
  "belfast",
  "belgrade",
  "bergen",
  "berlin",
  "bilbao",
  "birmingham",
  "boston",
  "bogota",
  "bologna",
  "bratislava",
  "brighton",
  "brisbane",
  "bristol",
  "brussels",
  "bucharest",
  "budapest",
  "buenos-aires",
  "cairo",
  "calgary",
  "cape-town",
  "cardiff",
  "casablanca",
  "charlotte",
  "chengdu",
  "chicago",
  "cologne",
  "copenhagen",
  "dallas",
  "delhi",
  "denver",
  "detroit",
  "doha",
  "dublin",
  "dubai",
  "edinburgh",
  "florence",
  "frankfurt",
  "geneva",
  "glasgow",
  "gothenburg",
  "granada",
  "guadalajara",
  "guangzhou",
  "hamburg",
  "helsinki",
  "hong-kong",
  "honolulu",
  "houston",
  "istanbul",
  "jakarta",
  "jerusalem",
  "johannesburg",
  "kansas-city",
  "karachi",
  "krakow",
  "kyoto",
  "lagos",
  "las-vegas",
  "lausanne",
  "leipzig",
  "lima",
  "lisbon",
  "london",
  "los-angeles",
  "lyon",
  "madrid",
  "manchester",
  "manila",
  "marseille",
  "melbourne",
  "mexico-city",
  "miami",
  "milan",
  "minneapolis",
  "monaco",
  "montreal",
  "mumbai",
  "munich",
  "nairobi",
  "naples",
  "nashville",
  "new-orleans",
  "new-york",
  "nice",
  "oakland",
  "osaka",
  "oslo",
  "ottawa",
  "paris",
  "philadelphia",
  "phoenix",
  "portland",
  "porto",
  "prague",
  "quito",
  "rio-de-janeiro",
  "rome",
  "rotterdam",
  "san-antonio",
  "san-diego",
  "san-francisco",
  "san-jose",
  "san-juan",
  "santiago",
  "sao-paulo",
  "seattle",
  "seoul",
  "seville",
  "shanghai",
  "shenzhen",
  "singapore",
  "sofia",
  "stockholm",
  "sydney",
  "taipei",
  "tallinn",
  "tbilisi",
  "tel-aviv",
  "thessaloniki",
  "tokyo",
  "toronto",
  "toulouse",
  "tunis",
  "turin",
  "valencia",
  "vancouver",
  "venice",
  "vienna",
  "vilnius",
  "warsaw",
  "wellington",
  "zagreb",
  "zurich",
] as const

/**
 * How a run decides which branch its work lands on:
 * - "auto": create a new branch with a generated city name (default).
 * - "custom": create a new branch with the caller-provided branch name.
 * - "base": stay on the base branch and commit directly to it.
 */
export type BranchMode = "auto" | "custom" | "base"

export function parseBranchMode(value: unknown): BranchMode {
  return value === "custom" || value === "base" ? value : "auto"
}

export function defaultBranchName() {
  const city = BRANCH_CITIES[Math.floor(Math.random() * BRANCH_CITIES.length)]

  return `cloudcode/${city}`
}

export function shuffledCityBranchNames(preferred: string) {
  const branchNames = BRANCH_CITIES.map((city) => `cloudcode/${city}`)

  for (let index = branchNames.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[branchNames[index], branchNames[randomIndex]] = [
      branchNames[randomIndex],
      branchNames[index],
    ]
  }

  return [
    preferred,
    ...branchNames.filter((branchName) => branchName !== preferred),
  ]
}

export function defaultBranchNameWithSuffix() {
  const city = BRANCH_CITIES[Math.floor(Math.random() * BRANCH_CITIES.length)]
  const suffix = Math.random().toString(36).slice(2, 8)

  return `cloudcode/${city}-${suffix}`
}
