function isPlaceholderMongoUri(uri) {
  if (!uri) return true;
  const lowered = uri.toLowerCase();
  return (
    lowered.includes('your_username') ||
    lowered.includes('your_password') ||
    lowered.includes('your_cluster') ||
    lowered.includes('your_mongodb_atlas_connection_string_here')
  );
}

function resolveMongoDbName() {
  return (
    process.env.MONGODB_ATLAS_DB ||
    process.env.MONGODB_DB ||
    process.env.MONGO_DB ||
    'mediqueue'
  );
}

function stripWrappingQuotes(value) {
  if (!value) return value;
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function ensureAuthSourceAdmin(uri) {
  if (!uri) return uri;
  const lowered = uri.toLowerCase();
  if (!lowered.startsWith('mongodb+srv://')) return uri;
  if (/(?:\?|&)authsource=/.test(lowered)) return uri;

  return uri.includes('?') ? `${uri}&authSource=admin` : `${uri}?authSource=admin`;
}

function resolveMongoUri() {
  const explicitUri = stripWrappingQuotes(process.env.MONGODB_URI || '');
  if (explicitUri && !isPlaceholderMongoUri(explicitUri)) {
    return { uri: ensureAuthSourceAdmin(explicitUri), source: 'MONGODB_URI' };
  }

  const atlasUser =
    process.env.MONGODB_ATLAS_USERNAME ||
    process.env.MONGODB_USERNAME ||
    process.env.MONGO_USERNAME;

  const atlasPassword =
    process.env.MONGODB_ATLAS_PASSWORD ||
    process.env.MONGODB_PASSWORD ||
    process.env.MONGO_PASSWORD;

  const atlasHost =
    process.env.MONGODB_ATLAS_HOST ||
    process.env.MONGO_ATLAS_HOST;

  const dbName = resolveMongoDbName();

  const rawAtlasParams = (process.env.MONGODB_ATLAS_PARAMS || '').trim();

  // Ensure authSource is present unless the user explicitly sets it.
  const atlasParams = (() => {
    const base = rawAtlasParams || 'retryWrites=true&w=majority';
    return /(?:^|&)authSource=/.test(base) ? base : `${base}&authSource=admin`;
  })();

  if (atlasUser && atlasPassword && atlasHost) {
    const user = encodeURIComponent(atlasUser);
    const pass = encodeURIComponent(atlasPassword);
    const host = atlasHost
      .replace(/^mongodb\+srv:\/\//i, '')
      .replace(/^mongodb:\/\//i, '');

    return {
      uri: `mongodb+srv://${user}:${pass}@${host}/${dbName}?${atlasParams}`,
      source: 'MONGODB_ATLAS_*',
    };
  }

  const localUri = stripWrappingQuotes(process.env.MONGODB_LOCAL_URI || '').trim();
  if (localUri) {
    return { uri: localUri, source: 'MONGODB_LOCAL_URI' };
  }

  if ((process.env.NODE_ENV || 'development') !== 'production') {
    return { uri: `mongodb://127.0.0.1:27017/${dbName}`, source: 'default-local' };
  }

  return { uri: '', source: 'none' };
}

function classifyMongoError(err) {
  const message = (err && err.message ? String(err.message) : '').toLowerCase();
  const codeName = err && err.codeName ? String(err.codeName) : '';

  if (
    message.includes('authentication failed') ||
    message.includes('bad auth') ||
    codeName === 'AtlasError'
  ) {
    return 'auth';
  }
  if (message.includes('ip') && message.includes('whitelist')) {
    return 'ip-whitelist';
  }
  if (
    message.includes('server selection') ||
    message.includes('could not connect to any servers')
  ) {
    return 'network';
  }
  return 'unknown';
}

async function connectMongo(mongoose) {
  const { uri, source } = resolveMongoUri();
  if (!uri) {
    const dbName = resolveMongoDbName();
    throw new Error(
      `Missing MongoDB configuration. Set MONGODB_URI (Atlas) or MONGODB_LOCAL_URI. Default expected DB: ${dbName}`
    );
  }

  mongoose.set('bufferCommands', false);

  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    return { uri, source };
  } catch (err) {
    const kind = classifyMongoError(err);

    const allowFallback =
      String(process.env.ALLOW_MONGO_LOCAL_FALLBACK || '').toLowerCase() === 'true';

    if (allowFallback && uri.startsWith('mongodb+srv://')) {
      const localUriFallback =
        stripWrappingQuotes(process.env.MONGODB_LOCAL_URI || '').trim() ||
        `mongodb://127.0.0.1:27017/${resolveMongoDbName()}`;

      try {
        await mongoose.connect(localUriFallback, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          serverSelectionTimeoutMS: 5000,
        });

        return {
          uri: localUriFallback,
          source: 'fallback-local',
          fallbackFrom: source,
          atlasErrorKind: kind,
        };
      } catch (fallbackErr) {
        fallbackErr.atlasError = err;
        throw fallbackErr;
      }
    }

    err.mongoErrorKind = kind;
    err.mongoUriSource = source;
    throw err;
  }
}

module.exports = {
  resolveMongoUri,
  connectMongo,
  classifyMongoError,
};