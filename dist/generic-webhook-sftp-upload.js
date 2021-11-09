#!/usr/bin/env node

/**
 * Generic Webhook to SFTP Upload CLI entry point.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module generic-webhook-sftp-upload
 */
"use strict";

const mri = require('mri');

const log = console;
process.on('uncaughtException', err => {
  log.error(`An unexpected error occurred\n  ${err.stack}`);
  process.exit(1);
});
process.on('unhandledRejection', err => {
  if (!err) {
    log.error('An unexpected empty rejection occurred');
  } else if (err instanceof Error) {
    log.error(`An unexpected rejection occurred\n  ${err.stack}`);
  } else {
    log.error(`An unexpected rejection occurred\n  ${err}`);
  }

  process.exit(1);
});

require('./app')(log).then(app => {
  const args = process.argv.slice(2);
  const parsed = mri(args, {
    alias: {
      final_newline: 'final-newline',
      name_spec: 'name-spec',
      root_spec: 'root-spec',
      sftp_host: 'sftp-host',
      sftp_port: 'sftp-port',
      sftp_password: 'sftp-password',
      sftp_username: 'sftp-username',
      task_seconds: 'task-seconds'
    },
    boolean: ['final_newline'],
    default: {
      config: '',
      encoding: 'utf8',
      final_newline: true,
      format: 'textl',
      host: 'localhost',
      name_spec: '/upload/{name}-{yyyy-LL-dd-HHmmss-SSS}-{random_3}.txt',
      port: 3000,
      root_spec: '/upload/{yyyy-LL-dd-HHmmss-SSS}-{random_3}.txt',
      sftp_host: '',
      sftp_password: '',
      sftp_port: 0,
      sftp_username: '',
      task_seconds: 30
    },
    string: ['config', 'encoding', 'format', 'name_spec', 'root_spec', 'secret', 'sftp_host', 'sftp_password', 'sftp_username']
  }); // Handle SIGTERM gracefully for Docker
  // SEE: http://joseoncode.com/2014/07/21/graceful-shutdown-in-node-dot-js/

  process.on('SIGTERM', () => {
    app.stop().then(() => process.exit(0));
  });
  return app.eval(parsed);
});