alter table public.user_preferences
  drop constraint user_preferences_genres_allowed,
  add constraint user_preferences_genres_allowed check (
    favorite_genres <@ array[
      'Action',
      'Action & Adventure',
      'Adventure',
      'Animation',
      'Comedy',
      'Crime',
      'Documentary',
      'Drama',
      'Family',
      'Fantasy',
      'History',
      'Horror',
      'Kids',
      'Music',
      'Mystery',
      'News',
      'Reality',
      'Romance',
      'Sci-Fi & Fantasy',
      'Science Fiction',
      'Soap',
      'Talk',
      'Thriller',
      'TV Movie',
      'War',
      'War & Politics',
      'Western'
    ]::text[]
  );
