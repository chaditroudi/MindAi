import 'dotenv/config';
import { getMongo, closeMongo } from '../src/db/mongo.client.js';

// ─── Directors ────────────────────────────────────────────────────────────────

const directors = [
  { name: 'Christopher Nolan',  nationality: 'British',    birthYear: 1970, totalFilms: 12 },
  { name: 'Steven Spielberg',   nationality: 'American',   birthYear: 1946, totalFilms: 35 },
  { name: 'Martin Scorsese',    nationality: 'American',   birthYear: 1942, totalFilms: 26 },
  { name: 'James Cameron',      nationality: 'Canadian',   birthYear: 1954, totalFilms: 10 },
  { name: 'Quentin Tarantino',  nationality: 'American',   birthYear: 1963, totalFilms: 10 },
  { name: 'Denis Villeneuve',   nationality: 'Canadian',   birthYear: 1967, totalFilms: 14 },
  { name: 'Ridley Scott',       nationality: 'British',    birthYear: 1937, totalFilms: 31 },
  { name: 'David Fincher',      nationality: 'American',   birthYear: 1962, totalFilms: 11 },
  { name: 'Wes Anderson',       nationality: 'American',   birthYear: 1969, totalFilms: 12 },
  { name: 'Alfonso Cuaron',     nationality: 'Mexican',    birthYear: 1961, totalFilms: 10 },
];

// ─── Films ────────────────────────────────────────────────────────────────────

const films = [
  { title: 'Inception',            genre: 'Sci-Fi',    year: 2010, director: 'Christopher Nolan', revenue: 836,  budget: 160, rating: 8.8, duration: 148, country: 'USA', studio: 'Warner Bros', awards: 4  },
  { title: 'The Dark Knight',      genre: 'Action',    year: 2008, director: 'Christopher Nolan', revenue: 1005, budget: 185, rating: 9.0, duration: 152, country: 'USA', studio: 'Warner Bros', awards: 8  },
  { title: 'Interstellar',         genre: 'Sci-Fi',    year: 2014, director: 'Christopher Nolan', revenue: 701,  budget: 165, rating: 8.6, duration: 169, country: 'USA', studio: 'Paramount',   awards: 5  },
  { title: 'Oppenheimer',          genre: 'Drama',     year: 2023, director: 'Christopher Nolan', revenue: 952,  budget: 100, rating: 8.9, duration: 180, country: 'USA', studio: 'Universal',   awards: 7  },
  { title: 'Dunkirk',              genre: 'Drama',     year: 2017, director: 'Christopher Nolan', revenue: 527,  budget: 100, rating: 7.9, duration: 106, country: 'UK',  studio: 'Warner Bros', awards: 3  },
  { title: 'Schindlers List',      genre: 'Drama',     year: 1993, director: 'Steven Spielberg',  revenue: 322,  budget: 22,  rating: 9.0, duration: 195, country: 'USA', studio: 'Universal',   awards: 7  },
  { title: 'Jurassic Park',        genre: 'Action',    year: 1993, director: 'Steven Spielberg',  revenue: 1046, budget: 63,  rating: 8.2, duration: 127, country: 'USA', studio: 'Universal',   awards: 3  },
  { title: 'Ready Player One',     genre: 'Sci-Fi',    year: 2018, director: 'Steven Spielberg',  revenue: 582,  budget: 175, rating: 7.4, duration: 140, country: 'USA', studio: 'Warner Bros', awards: 1  },
  { title: 'The Departed',         genre: 'Thriller',  year: 2006, director: 'Martin Scorsese',   revenue: 290,  budget: 90,  rating: 8.5, duration: 151, country: 'USA', studio: 'Warner Bros', awards: 4  },
  { title: 'Goodfellas',           genre: 'Crime',     year: 1990, director: 'Martin Scorsese',   revenue: 47,   budget: 25,  rating: 8.7, duration: 145, country: 'USA', studio: 'Warner Bros', awards: 1  },
  { title: 'The Wolf of Wall St',  genre: 'Comedy',    year: 2013, director: 'Martin Scorsese',   revenue: 392,  budget: 100, rating: 8.2, duration: 180, country: 'USA', studio: 'Paramount',   awards: 0  },
  { title: 'Avatar',               genre: 'Sci-Fi',    year: 2009, director: 'James Cameron',     revenue: 2923, budget: 237, rating: 7.8, duration: 162, country: 'USA', studio: 'Fox',         awards: 3  },
  { title: 'Avatar: Way of Water', genre: 'Sci-Fi',    year: 2022, director: 'James Cameron',     revenue: 2320, budget: 350, rating: 7.6, duration: 192, country: 'USA', studio: 'Fox',         awards: 1  },
  { title: 'Titanic',              genre: 'Romance',   year: 1997, director: 'James Cameron',     revenue: 2264, budget: 200, rating: 7.9, duration: 194, country: 'USA', studio: 'Paramount',   awards: 11 },
  { title: 'Pulp Fiction',         genre: 'Crime',     year: 1994, director: 'Quentin Tarantino', revenue: 213,  budget: 8,   rating: 8.9, duration: 154, country: 'USA', studio: 'Miramax',     awards: 1  },
  { title: 'Django Unchained',     genre: 'Western',   year: 2012, director: 'Quentin Tarantino', revenue: 425,  budget: 100, rating: 8.4, duration: 165, country: 'USA', studio: 'Weinstein',   awards: 2  },
  { title: 'Inglourious Basterds', genre: 'Drama',     year: 2009, director: 'Quentin Tarantino', revenue: 321,  budget: 70,  rating: 8.3, duration: 153, country: 'USA', studio: 'Weinstein',   awards: 1  },
  { title: 'Dune',                 genre: 'Sci-Fi',    year: 2021, director: 'Denis Villeneuve',  revenue: 402,  budget: 165, rating: 8.0, duration: 155, country: 'USA', studio: 'Warner Bros', awards: 6  },
  { title: 'Dune Part Two',        genre: 'Sci-Fi',    year: 2024, director: 'Denis Villeneuve',  revenue: 714,  budget: 190, rating: 8.5, duration: 166, country: 'USA', studio: 'Warner Bros', awards: 2  },
  { title: 'Blade Runner 2049',    genre: 'Sci-Fi',    year: 2017, director: 'Denis Villeneuve',  revenue: 260,  budget: 150, rating: 8.0, duration: 164, country: 'USA', studio: 'Warner Bros', awards: 5  },
  { title: 'Arrival',              genre: 'Sci-Fi',    year: 2016, director: 'Denis Villeneuve',  revenue: 203,  budget: 47,  rating: 7.9, duration: 116, country: 'USA', studio: 'Paramount',   awards: 1  },
  { title: 'Gladiator',            genre: 'Action',    year: 2000, director: 'Ridley Scott',      revenue: 461,  budget: 103, rating: 8.5, duration: 155, country: 'USA', studio: 'Universal',   awards: 5  },
  { title: 'The Martian',          genre: 'Sci-Fi',    year: 2015, director: 'Ridley Scott',      revenue: 630,  budget: 108, rating: 8.0, duration: 144, country: 'USA', studio: 'Fox',         awards: 1  },
  { title: 'Fight Club',           genre: 'Thriller',  year: 1999, director: 'David Fincher',     revenue: 101,  budget: 63,  rating: 8.8, duration: 139, country: 'USA', studio: 'Fox',         awards: 0  },
  { title: 'Gone Girl',            genre: 'Thriller',  year: 2014, director: 'David Fincher',     revenue: 369,  budget: 61,  rating: 8.1, duration: 149, country: 'USA', studio: 'Fox',         awards: 0  },
  { title: 'The Social Network',   genre: 'Drama',     year: 2010, director: 'David Fincher',     revenue: 224,  budget: 40,  rating: 7.7, duration: 120, country: 'USA', studio: 'Columbia',    awards: 3  },
  { title: 'The Grand Budapest',   genre: 'Comedy',    year: 2014, director: 'Wes Anderson',      revenue: 175,  budget: 25,  rating: 8.1, duration: 99,  country: 'USA', studio: 'Fox',         awards: 4  },
  { title: 'Asteroid City',        genre: 'Comedy',    year: 2023, director: 'Wes Anderson',      revenue: 29,   budget: 25,  rating: 6.6, duration: 105, country: 'USA', studio: 'Universal',   awards: 0  },
  { title: 'Gravity',              genre: 'Sci-Fi',    year: 2013, director: 'Alfonso Cuaron',    revenue: 723,  budget: 100, rating: 7.7, duration: 91,  country: 'USA', studio: 'Warner Bros', awards: 7  },
  { title: 'Roma',                 genre: 'Drama',     year: 2018, director: 'Alfonso Cuaron',    revenue: 5,    budget: 15,  rating: 7.7, duration: 135, country: 'MEX', studio: 'Netflix',     awards: 3  },
];

// ─── Source definitions ───────────────────────────────────────────────────────

const filmsSource = {
  name:        'Films',
  collection:  'films',
  description: 'Popular films with revenue, budget, genre, rating, and awards data.',
  fields: [
    { name: 'title',    type: 'string',  role: 'dimension', description: 'Film title' },
    { name: 'genre',    type: 'enum',    role: 'dimension', enumValues: ['Sci-Fi','Action','Drama','Thriller','Crime','Comedy','Romance','Western','Horror'] },
    { name: 'year',     type: 'integer', role: 'temporal',  description: 'Release year' },
    { name: 'director', type: 'string',  role: 'dimension', description: 'Director full name', referenceTo: 'directors.name' },
    { name: 'revenue',  type: 'number',  role: 'measure',   description: 'Box office revenue in million USD' },
    { name: 'budget',   type: 'number',  role: 'measure',   description: 'Production budget in million USD' },
    { name: 'rating',   type: 'number',  role: 'measure',   description: 'IMDb rating out of 10' },
    { name: 'duration', type: 'integer', role: 'measure',   description: 'Film duration in minutes' },
    { name: 'country',  type: 'string',  role: 'dimension', description: 'Production country' },
    { name: 'studio',   type: 'string',  role: 'dimension', description: 'Production studio' },
    { name: 'awards',   type: 'integer', role: 'measure',   description: 'Number of awards won' },
  ],
  joins: [
    { from: 'directors', localField: 'director', foreignField: 'name', as: 'directorInfo' },
  ],
};

const directorsSource = {
  name:        'Directors',
  collection:  'directors',
  description: 'Film directors with nationality and career statistics.',
  fields: [
    { name: 'name',        type: 'string',  role: 'dimension', description: 'Director full name' },
    { name: 'nationality', type: 'string',  role: 'dimension', description: 'Director nationality' },
    { name: 'birthYear',   type: 'integer', role: 'temporal',  description: 'Year of birth' },
    { name: 'totalFilms',  type: 'integer', role: 'measure',   description: 'Total films directed' },
  ],
};

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n Seeding MindAi database...\n');
  const { db } = await getMongo();

  // films
  await db.collection('films').drop().catch(() => {});
  await db.collection('films').insertMany(films);
  console.log(`  ✓ films       — ${films.length} documents`);

  // directors
  await db.collection('directors').drop().catch(() => {});
  await db.collection('directors').insertMany(directors);
  console.log(`  ✓ directors   — ${directors.length} documents`);

  // sources
  await db.collection('sources').replaceOne({ collection: 'films' },     filmsSource,     { upsert: true });
  await db.collection('sources').replaceOne({ collection: 'directors' }, directorsSource, { upsert: true });
  console.log('  ✓ sources     — 2 registered (films, directors)');

  console.log('\n Done. Run `npm run dev` and start querying.\n');
  await closeMongo();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
