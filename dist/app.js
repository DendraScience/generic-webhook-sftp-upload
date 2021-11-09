"use strict";

/**
 * Generic Webhook to SFTP Upload CLI app.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module app
 */
const loadJsonFile = require('load-json-file');

const {
  DateTime
} = require('luxon');

const {
  Client
} = require('ssh2');

const {
  SeqQueue
} = require('./seq-queue');

const schema = {
  body: {
    oneOf: [{
      type: 'array'
    }, {
      type: 'object'
    }]
  }
};
const macros = {
  random_2() {
    return Math.floor(Math.random() * (99 - 0) + 0).toString().padStart(2, '0');
  },

  random_3() {
    return Math.floor(Math.random() * (999 - 0) + 0).toString().padStart(3, '0');
  }

};

function buildPath(spec, params) {
  return spec.replace(/{([^}]+)}/g, (_, k) => {
    return params[k] !== undefined ? params[k] : macros[k] !== undefined ? macros[k]() : DateTime.utc().toFormat(k);
  });
}

function formatBody(body, {
  final_newline: finalNewLine,
  format
}) {
  if (format === 'json') {
    return JSON.stringify(body) + (finalNewLine ? '\n' : '');
  } else if (format === 'jsonl' && Array.isArray(body)) {
    return body.map(item => JSON.stringify(item)).join('\n') + (finalNewLine ? '\n' : '');
  } else if (format === 'textl' && Array.isArray(body)) {
    return body.filter(item => typeof item === 'string').join('\n') + (finalNewLine ? '\n' : '');
  } else {
    return '';
  }
}

module.exports = async log => {
  const app = {
    taskSeconds: 0
  };

  const handleError = err => {
    log.error(`Task error\n  ${err}`);
  };

  const runTask = async () => {
    const {
      ssh
    } = app;
    log.info('Task running...');
    if (!ssh) return;
    if (ssh.sftp) return;
    if (ssh.conn) ssh.conn.removeAllListeners();
    log.info('SSH client connecting');
    ssh.conn = new Client();
    ssh.conn.once('close', () => {
      ssh.sftp = undefined;
      log.info('SSH client close');
    });
    ssh.conn.once('end', () => {
      ssh.sftp = undefined;
      log.info('SSH client end');
    });
    ssh.conn.once('ready', () => {
      log.info('SSH client ready');
      ssh.conn.sftp((err, sftp) => {
        if (err) {
          log.error(`SFTP session error\n  ${err}`);
        } else {
          ssh.sftp = sftp;
          log.info('SFTP session established');
        }
      });
    });
    ssh.conn.on('error', err => {
      log.error(`SSH client error\n  ${err}`);
    });
    ssh.conn.connect(ssh.opts);
  };

  const scheduleTask = () => {
    log.info(`Task starting in ${app.taskSeconds} seconds`);
    app.taskTid = setTimeout(() => {
      runTask().catch(handleError).then(scheduleTask);
    }, app.taskSeconds * 1000);
  };

  const handleRequest = async ({
    body,
    id,
    params
  }, spec, p) => {
    log.info(`Webhook data received ${id}`);
    if (!app.ssh.conn) throw new Error('SSH client not ready');
    if (!app.ssh.sftp) throw new Error('SFTP session not established');
    const options = {
      flags: 'w',
      encoding: null,
      mode: 0o666,
      autoClose: true
    };
    const path = buildPath(spec, params);
    let stream;
    await app.queue.push(() => {
      return new Promise((resolve, reject) => {
        stream = app.ssh.sftp.createWriteStream(path, options);
        stream.once('error', err => {
          reject(new Error(`Upload error: ${err.message}`));
        });
        stream.once('finish', resolve);
        stream.end(Buffer.from(formatBody(body, p)), p.encoding);
      }).finally(() => {
        if (stream) {
          stream.removeAllListeners();
          if (options.autoClose === false) stream.destroy();
        }
      });
    });
    log.info(`Webhook data published ${id} ${path}`);
    return {
      id,
      path
    };
  }; // App setup


  app.eval = async p => {
    if (!p.secret) throw new Error('Required: secret');
    const config = p.config ? await loadJsonFile(p.config) : {};
    app.queue = new SeqQueue();
    app.ssh = {
      opts: Object.assign({
        host: 'localhost',
        port: 22
      }, config.ssh2, p.sftp_host ? {
        host: p.sftp_host
      } : undefined, p.sftp_port ? {
        port: p.sftp_port
      } : undefined, p.sftp_username ? {
        username: p.sftp_username
      } : undefined, p.sftp_password ? {
        password: p.sftp_password
      } : undefined)
    };
    scheduleTask();
    app.taskSeconds = p.task_seconds;

    const fastify = require('fastify')();

    fastify.addHook('preHandler', (request, reply, done) => {
      if (request.headers.authorization === p.secret) done();else {
        reply.code(401);
        done(new Error('Unauthorized'));
      }
    });
    fastify.post('/', {
      schema
    }, async request => {
      return handleRequest(request, p.root_spec, p);
    });
    fastify.post('/:name(^\\w+)', {
      schema
    }, async request => {
      return handleRequest(request, p.name_spec, p);
    });
    const address = await fastify.listen(p.port, p.host);
    log.info(`Webhook listening on ${address}`);
    app.fastify = fastify;
  };

  app.stop = () => app.fastify && app.fastify.close();

  return app;
};