var elasticsearch = require('elasticsearch');

/**
 * Queries ES with specied query string
 *
 * @param config - object has properties which contain index info
 * @param params - params is passed as req.query
 * @param res - the response object
 * @param query - the query string
 * @param handler - call back function 
 */
exports.query = function(config, params, res, query, handler, aggs) {
  var client = new elasticsearch.Client({
    host: config.url
  });

  var sort = {};
  if (params && params.sort) {
    sort[params.sort] = {
      "order": (params ? params.order : null),
      "ignore_unmapped": true
    }
  }

  // Execute ES Query
  client.search({
    index: config.index,
    type: config.type,
    from: params ? params.from : null,
    size: params ? params.size : null,
    body: {
      sort: sort ? [sort] : null,
      query: query,
      aggs: aggs,
      highlight: {
        number_of_fragments: 0,
        pre_tags: ["<mark>"],
        post_tags: ["</mark>"],
        fields: {
          "*": {}
        },
        require_field_match: false
      },
    }
  }).then(function(resp) {
    // Parse ES response and send result back
    var hits = module.exports.parseSearchHits(resp, res);

    var aggsArr = [];
    if(aggs && (typeof aggs !== 'function')) {
      for(var x in resp.aggregations) {
        aggsArr.push((resp.aggregations[x].buckets));
      }
    }

    if (handler) {
      handler(res, hits, resp.hits.total, aggsArr);
    } else {
      module.exports.defaultHandler(res, hits, resp.hits.total, true, aggsArr);
    }

    // Release client resources
    client.close();
  }, function(err) {
    errorMessage(err, res)
  });
};

/**
 * Parses an ES response, formats it and sends data on the HTTP response.
 *
 * @param resp - HTTP response object from queries
 * @param res - HTTP response
 */
exports.parseSearchHits = function(resp, res) {
  return resp.hits.hits.map(function(hit) {
    // return hit._source;
    var source = hit._source;

    if (hit.highlight) {
      for (var k in hit.highlight) {
        // Merge key into source object
        merge(source, k, hit.highlight[k][0], ["id"]);
      }
    } 
    return source;

  });
}

/**
 * sends a JSON formatted object of hits
 *
 * @param res - HTTP response from queries
 * @param hits - Data in array format
 * @param count - Numbr of hits
 * @param aggs - aggregations
 */
exports.defaultHandler = function(res, hits, count, useCount, aggs) {
  if(aggs)
    res.json({
      "rows": hits,
      "size": count,
      "aggs": aggs
    });
  else if (useCount)
    res.json({
      "rows": hits,
      "size": count
    });
  else
    res.json(hits);
}

/**
 * Returns aggregated data based on search query for autocomplete functionality
 *
 * @param config - object that contains index, url, and type of ES
 * @param term - params contains the search term
 * @param field - field is set to additionalInfo.resume
 * @param res - HTTP response to send back data
 */
exports.suggest = function(config, term, field, res) {
  var client = new elasticsearch.Client({
    host: config.url
  });

  var firstTerm = term.split(" ");
  var lastTerm = firstTerm.pop();

  client.search({
    index: config.index,
    type: config.type,
    body: {
      size: 0,
      aggs: {
        autocomplete: {
          terms: {
            size: 5,
            field: field,
            include: lastTerm + ".*",
            order: {
              _count: "desc"
            }
          }
        }
      },
      query: {
        query_string: {
          query: term + "*",
          default_operator: "AND"
        }
      }
    }
  }).then(function(resp) {
    var hits = module.exports.getAutocompleteKeys(resp);
    var prefix = firstTerm.join(" ");

    for (var x in hits) {
      hits[x] = prefix + " " + hits[x];
    }

    module.exports.defaultHandler(res, hits, resp.hits.total, false);
    client.close();
  }, function(err) {
    errorMessage(err, res);
  });
}

/**
 * Returns the unique terms indexed for a given field & the number of matching documents
 * @param config - object that contains index, url, and type of ES
 * @param field - field is set to additionalInfo.resume
 * @param query - performs a query first if requested
 * @param res - HTTP response to send back data
 */
exports.aggregations = function(config, query, res, aggs) {
  var client = new elasticsearch.Client({
    host: config.url
  });

  client.search({
    index: config.index,
    type: config.type,
    body: {
      size: 0,
      query: query,
      aggs: aggs
    }
  }).then(function(resp) {
    var hits = module.exports.getAggregationHits(resp);
    module.exports.defaultHandler(res, hits, resp.hits.total, false);
    client.close();
  }, function(err) {
    errorMessage(err, res);
  });
}


/*
 * Returns the keys  associated with each bucket for suggest
 *
 * @param resp - HTTP response from suggest after a search is done
 */
exports.getAutocompleteKeys = function(resp) {
  return resp.aggregations.autocomplete.buckets.map(function(hit) {
    return hit.key;
  });
}

/**
 * Returns the keys & doc_count associated with each bucket for aggregations
 *
 * @param resp - HTTP response 
 */
exports.getAggregationHits = function(resp) {
  var hits = [];
  for(var x in resp.aggregations) {
    hits.push(resp.aggregations[x].buckets);
  }

  return hits;
}

/**
 * Indexes data in ES
 *
 * @param config - object that contains indexing info (labels or uploads only)
 * @param params - associated with req.query
 * @param res - HTTP response object to send back data 
 */
exports.index = function(config, params, res) {
  var client = new elasticsearch.Client({
    host: config.url
  });

  client.index({
    index: config.index,
    type: config.type,
    id: params.id,
    body: {
      id: params.id,
      type: params.type
    },
    refresh: true
  }).then(function(response) {
    client.close();
    res.end();
  }, function(err) {
    errorMessage(err, res);
  });
}

/**
 * Indexes uploaded resumes in ES
 *
 * @param config - object that contains indexing info (labels or uploads only)
 * @param params - associated with req.query
 * @param res - HTTP response object to send back data 
 */
exports.indexUploads = function(config, params, res) {
  var client = new elasticsearch.Client({
    host: config.url
  });

  client.index({
    index: config.index,
    type: config.type,
    id: params.id,
    body: {
      id: params.id,
      type: params.type,
      name: params.name,
      base64string: params.base64string,
      processed: params.processed
    },
    refresh: true
  }).then(function(response) {
    client.close();
    res.end();
  }, function(err) {
    errorMessage(err, res);
  });
}

/**
 * Deletes an in index in ES
 *
 * @param config - object that contains info about the index being deleted
 * @param params - params maps to req.body
 * @param res - HTTP response object
 */
exports.delete = function(config, params, res) {
  var client = new elasticsearch.Client({
    host: config.url
  });

  client.delete({
    index: config.index,
    type: config.type,
    id: params.id
  }).then(function(response) {
    client.close();
    res.end();
  }, function(err) {
    errorMessage(err, res);
  });
}

/** Logs any errors after CRUD operations
 *
 * @param err - the error
 * @param res - HTTP response object
 */
function errorMessage(err, res) {
  console.log(err.message);
  res.status(500).send(err.message);

  // Release client resources
  client.close();
  res.end();
}

function merge(object, key, value, excludes) {
  // Merge value into object if it's not excluded
  if (excludes.indexOf(key) == -1) {
    key = key.split(".");

    // Find child object
    if (key.length > 1) {
      for (var x = 0; x < key.length - 1; x++) {
        object = object[key[x]];
      }
    }

    // If the objects is an array, replace array element. Else replace entire value.
    if (object[key[key.length - 1]] instanceof Array) {
      var element = object[key[key.length - 1]];
      for (var x = 0; x < element.length; x++) {
        if (value.indexOf(element[x]) > -1) {
          element[x] = value;
        }
      }
    } else {
      object[key[key.length - 1]] = value;
    }
  }
}