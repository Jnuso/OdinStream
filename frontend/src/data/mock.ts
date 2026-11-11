// Fictional users and reviews for the social UI. IDs are fixtures, not TMDB IDs.
export interface Title {
  id: number;
  name: string;
  year: number;
  kind: "Movie" | "TV show";
  genre: string;
  description: string;
}
export interface User {
  id: string;
  name: string;
  handle: string;
  bio: string;
  initials: string;
  color: string;
}
export interface Post {
  id: string;
  userId: string;
  titleId: number;
  rating: number;
  review: string;
  createdAt: string;
}
export interface SocialState {
  posts: Post[];
  following: string[];
  country: string;
  services: string[];
}
export const currentUserId = "raif";
export const users: User[] = [
  {
    id: "raif",
    name: "Raif Rashid",
    handle: "raif.watches",
    bio: "One more episode. Then one more movie.",
    initials: "RR",
    color: "olive",
  },
  {
    id: "maya",
    name: "Maya Chen",
    handle: "maya.watches",
    bio: "Big screens, small details. Always staying for the credits.",
    initials: "MC",
    color: "rose",
  },
  {
    id: "leo",
    name: "Leo Brooks",
    handle: "leo.afterhours",
    bio: "Sci-fi worlds and stories that stay with you.",
    initials: "LB",
    color: "blue",
  },
  {
    id: "jules",
    name: "Jules Park",
    handle: "jules.onfilm",
    bio: "Collecting good stories, one frame at a time.",
    initials: "JP",
    color: "sand",
  },
];
export const catalog: Title[] = [
  {
    id: 1,
    name: "Dune: Part Two",
    year: 2024,
    kind: "Movie",
    genre: "Sci-fi",
    description:
      "On Arrakis, Paul Atreides joins the Fremen and faces a choice between love and destiny.",
  },
  {
    id: 2,
    name: "Severance",
    year: 2022,
    kind: "TV show",
    genre: "Thriller",
    description:
      "A team whose work and personal memories are separated begins to question the world inside the office.",
  },
  {
    id: 3,
    name: "The Bear",
    year: 2022,
    kind: "TV show",
    genre: "Drama",
    description:
      "A chef returns to his family’s Chicago sandwich shop and finds a new kind of family in the kitchen.",
  },
  {
    id: 4,
    name: "Past Lives",
    year: 2023,
    kind: "Movie",
    genre: "Romance",
    description:
      "Childhood friends reunite in New York and consider the lives they chose and the possibilities left behind.",
  },
  {
    id: 5,
    name: "Andor",
    year: 2022,
    kind: "TV show",
    genre: "Sci-fi",
    description:
      "Under Imperial rule, Cassian Andor discovers his place in a growing rebellion.",
  },
  {
    id: 6,
    name: "The Grand Budapest Hotel",
    year: 2014,
    kind: "Movie",
    genre: "Comedy",
    description:
      "A concierge and a lobby boy become unlikely companions in a caper across a changing Europe.",
  },
];
export const serviceOptions = [
  "Netflix",
  "Max",
  "Apple TV+",
  "Hulu",
  "Disney+",
];
export const countryOptions = [
  "United States",
  "Canada",
  "United Kingdom",
  "India",
];
export const initialState: SocialState = {
  following: ["maya", "leo"],
  country: "United States",
  services: ["Max", "Apple TV+"],
  posts: [
    {
      id: "post-maya",
      userId: "maya",
      titleId: 1,
      rating: 5,
      review:
        "Some films remind you why the big screen matters. The scale, the sound, the silence between it all. Still thinking about that final act.",
      createdAt: "2026-11-11T16:00:00Z",
    },
    {
      id: "post-leo",
      userId: "leo",
      titleId: 2,
      rating: 4,
      review:
        "Every hallway feels like a question. I came for the premise and stayed for the people. A wonderfully unsettling watch.",
      createdAt: "2026-11-11T14:00:00Z",
    },
    {
      id: "post-jules",
      userId: "jules",
      titleId: 4,
      rating: 5,
      review:
        "A quiet story that somehow says everything. The kind of movie that makes the walk home feel a little different.",
      createdAt: "2026-11-10T18:00:00Z",
    },
    {
      id: "post-raif",
      userId: "raif",
      titleId: 5,
      rating: 5,
      review:
        "A galaxy far away has never felt this human. Every small choice carries weight. This is the kind of storytelling I keep coming back for.",
      createdAt: "2026-11-09T18:00:00Z",
    },
  ],
};
