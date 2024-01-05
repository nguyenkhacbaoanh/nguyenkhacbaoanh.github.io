---
title: CRUD Api Swagger Informatica
description: Api for Informatica's Admin
date: 2020-04-21
draft: false
slug: /pensieve/api-informatica
tags:
  - API
  - Oauth2
---

![API Architecture](../../featured/api_informatica/api_architecture.png 'architecture')

Api heberge sur 2 zone de securite different, c'est pour ca, nous avons 2 workers qui vont deployer differenement, un sur docker et un autre sur la VM Cloud (qui necessite d'avoir l'ouverture de route sur GBIS)

Api a ete developpe par Python version 3.6 en utilisant des libraries: `requirements.txt`.

```text
flask-restplus==0.11.0
pytest==3.8.2
pytest-mock==1.10.0
faker==0.9.0
redis==3.2.0
celery==4.3.0
flower==0.9.2
ansible==2.7.4
gunicorn==19.9.0
sg-cacert-file==2.0.2
```

Structuration du projet:
.

- ETLaaS_GCR_async
  - app
    - ansible
      - inventory
      - playbook
    - apis
      - authentication.py
      - grchost.py
      - health_check.py
      - informatica.py
      - jobs.py
      - uuid.py
    - config
    - core
      - actions.py
      - cloud_permission.py
      - utils.py
      - exception.py
      - decorators.py
      - killsession.py
    - tasks
      - add.py
      - find_command.py
      - list_repository.py
    - tests
      - mock_classes.py
      - test_calc.py
      - test_cases.py
      - test_version.py
    - **init**.py
  - config
    - GCR.csv
    - IFARCRSERVER.csv
    - default.py
    - gunicorn_conf.py
    - sg_datalake.cfg
  - dockers
    - app
    - celery
    - flower
    - redis
  - kube
    - deployment.yml
    - service.yml
    - ingress.yml
    - secret-env.yml
  - run
    - dev-env.sh
    - prd-env.sh
  - ssl
  - swagger

## APIs

This APIs utilise asynchro technique pour recuperer le resultat sur les task qui dure longtemps en generale, une fois le job a ete submit sur APIs, les playbooks ansible vont jouer des commandlines sur des servers specifiques, ca va prendre de deux a 5 minutes, ca depends la bande passante du reseau.

```python
#UUID.py
from flask import Flask,jsonify, g
from datetime import datetime, timedelta
from flask_restplus import Namespace, Resource, fields, marshal
from app.core.cloud_permission import check_cloud_permission
from app.core.decorators import DecoratedResource
#from app.app_file import app, redis_cache
# from flask_sg_datalake import DatalakeRecord
from app.core.utils import transaction_correlation_id as correlation_id
#import redis_cache
from flask_sg_datalake import DatalakeRecord
import logging
namespace = Namespace('UUID', description='Get async output here')
dl_logger = logging.getLogger('datalake')

@namespace.route("/<uuid>")
class Job(Resource):
    """Get the job"""

    @namespace.doc(description="get your job result")
    def get(self, uuid):
        from app.app_file import redis_cache
        if redis_cache.get(uuid) is None:
            task_not_exist = {
                               "id": uuid,
                               "details": "The task does not exist"}
            return task_not_exist, 404
        else:
            from app import celery
            return_celery_obj = celery.AsyncResult(uuid)
            default_result = {
                          "status": return_celery_obj.status,
                          "id": return_celery_obj.id,
                          "details": "The task is being executed,may take longer than 2mins. please click on try it out again"}
            if return_celery_obj.status != "PENDING":
                redis_cache.delete(uuid)
            if return_celery_obj.ready():
                default_result["details"] = return_celery_obj.result
                g.dl_logger.info(DatalakeRecord(correlation_id, event="response", response_http_code=200,
                                                response_message=return_celery_obj.id, details=return_celery_obj.result))
                return default_result, 200
            else:
                g.dl_logger.info(DatalakeRecord(correlation_id, event="response", response_http_code=200,
                                                response_message=return_celery_obj.id,
                                                details=return_celery_obj.result))
                return default_result, 200
```

Some examples of Api methods

```python
#informatica.py
from flask import jsonify, g
from datetime import datetime, timedelta
from flask_restplus import Namespace, fields, reqparse, marshal
from app.apis.authentication import parsetoken
from app.core.cloud_permission import check_cloud_permission
from app.core.csvreader import check_csvfile
from app.core.exception import NoSuchResource, InvalidUsage
from app.core.decorators import Resource,DecoratedResource
from app.core.actions import find_command, find_command_IS
import logging
import json, os
from flask_sg_datalake import DatalakeRecord
from app.core.utils import transaction_correlation_id as correlation_id
dl_logger = logging.getLogger('datalake')

namespace = Namespace(
    "informatica", description="Informatica Services")

instance_schema_in = namespace.model('Action', {
    "action": fields.String(
        description="Start/Stop",
        required=True
    )})

instance_schema_out = namespace.model('Task', {
    'result': fields.String(description='your task result',
                          required=True)
})

parser = reqparse.RequestParser()
parser.add_argument("Domain name", type=str, required=True)
parser.add_argument("Domain Host name", type=str, required=True)
parser.add_argument("Environment", type=str, required=True)
parser.add_argument("IS_name", type=str, required=True)

@namespace.errorhandler(InvalidUsage)
@namespace.errorhandler(NoSuchResource)
def handle_invalid_usage(error):
    """ Catch and forward to app.errorhandler InvalidUsage exceptions """
    response = jsonify(error.to_dict())
    response.status_code = error.status_code
    return response

#List IS
@namespace.route("/trigrams/<trigram>/domains/<domain_name>/integration-services/")
@namespace.param('Domain Host name', 'your domain host name.Give SVCToolname ex: xxx')
@namespace.param('Environment', 'your application environment ex: Development, Homologation, Production')
@namespace.doc(security=[{'oauth2_implicit': ['profile', 'itaas', 'openid']}])
class list_Instance(DecoratedResource):
    """Shows your IS status"""
    @namespace.doc(description="This function will show your instance status.\n\r"
                               "Please input your respective information according to token.\n\r"
                               "This part should be changed with IAMaaS in the future.")
    @namespace.response(400, "Invalid Usage - OAuth2.0 Failed")
    @namespace.response(404, "No Such Service")
    @namespace.response(403, "Please verify the domain or contact ETL adm for update the domain list into api")
    def get(self, trigram, domain_name):
        """check your IS status.
        This endpoint returns the Infrastructure Service(IS) list present in server.
        Endpoint will return according to your token and your account.
        ***The information need for json in the request:***
        * trigram[required]:
            your application trigram.Ex: MAE
        * domain_name:
            domain present in requested server.Ex: AAA_XXX_X00
        * domain_hostname:
            use valid SVCToolname.EX: xxx
        * environment:
            use environment like Development, Homologation and Production.
        <br/><br/>"""
        args = parsetoken()
        hostname = args['Domain Host name']
        Environment = args['Environment'].upper()
        print(trigram, domain_name)
        token_info = self.get_token_info(g.token)
        cloud_res = check_cloud_permission(token_info['login_ad'])
        """ Exception for E2S: verify the E2S in AD group list and proceed for ansible playbook run  """
        if not tri_search(cloud_res, trigram):
            csv_res = check_csvfile(domain_name.upper(), args['Environment'], cloud_res)
            if not csv_res:
                raise NoSuchResource("trigram not added to AD group list/No such Domain in inventory", 200)
        """ Verify hostname """
        if not hostname.endswith(".socgen"):
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=500,
                                             response_message="hostname invalid"))
            raise InvalidUsage("hostname invalid. Use FQDN ex: xxx", 500)

        from app.tasks.find_command import find_command
        task =find_command.apply_async(
            kwargs={'hostname': hostname,
                    'action': "ping"},
            expires=datetime.now() + timedelta(minutes=10))
        print("returning task", task.id, task.status)
        from app.app_file import redis_cache
        redis_cache.set(task.id, task.status)
        if task.id is not None:
            g.dl_logger.info(DatalakeRecord(
                 correlation_id, event="response", response_http_code=202, response_message=task.id, details=task.id))
            return {'hostname': hostname,
                    'trigram': trigram,
                    'Domain_name': domain_name,
                    'Environment': Environment,
                    'uuid': task.id }, 202
        else:
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=402,
                                              response_message="Something wrong went."))
            return "Something went wrong. Please try it again", 402

    @staticmethod
    def parse_is_action():
        """Get the input to find which IS will be operated"""
        parser = reqparse.RequestParser()
        parser.add_argument("action", type=str)
        return parser.parse_args()

    @staticmethod
    def get_token_info(token):

        """ Return informations from a given token """
        token_info = {"login_ad": token.login_ad(),
                      "mail": token.mail(),
                      "expired": token.is_expired()}
        return token_info

#Start/Stop IS
@namespace.route("/trigrams/<trigram>/domains/<domain_name>/integration-services/<IS_name>")
@namespace.param('Domain Host name', 'your domain host name.Give SVCToolname ex: xxx')
@namespace.param('Environment', 'your application environment ex: Development, Homologation, Production')
@namespace.doc(security=[{'oauth2_implicit': ['profile', 'itaas', 'openid']}])
class put_Instance(DecoratedResource):
    """Start/Stop your IS"""
    @namespace.doc(description="This function will start/stop your service.\n\r"
                               "Please input your respective information according to token.\n\r"
                               "This part should be changed with IAMaaS in the future.")
    @namespace.response(202, "Valid uuid created for task")
    @namespace.response(400, "Invalid Usage - OAuth2.0 Failed")
    @namespace.response(404, "No Such Service")
    @namespace.response(403, "Please verify the domain or contact ETL adm for update the domain list into api")
    @namespace.expect(instance_schema_in)

    def put(self, trigram, domain_name, IS_name):
        """Start/Stop IS.
        This endpoint start/stop Infrastructure Service(IS) present in server.
        Endpoint will return according to your token and your account.<br/><br/>
        ***The information need for json in the request:***
        * trigram[required]:
            your application trigram.Ex: MAE
        * IS name[required]:
            IS name to be start/stop. Ex: INT_MAE_D01
        * domain_name:
            domain present in requested server.Ex: AAA_XXX_X00
        * domain_hostname:
            use valid SVCToolname.EX: xxx
        * environment:
            use environment like Development, Homologation and Production.
        """
        args = parsetoken()
        # IS_name = args['IS_name'].upper()
        hostname = args['Domain Host name']
        Environment = args['Environment'].upper()
        action = self.parse_is_action()
        if action['action'].upper() not in ['START', 'STOP']:
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=404,
                                            response_message="Action not specified"))
            raise NoSuchResource('No such action', 404)

        token_info = self.get_token_info(g.token)
        cloud_res = check_cloud_permission(token_info['login_ad'])

        """ Exception for E2S: verify the E2S in AD group list and proceed for ansible playbook run  """
        if not tri_search(cloud_res, trigram):
            csv_res = check_csvfile(domain_name.upper(), args['Environment'], cloud_res)
            if not csv_res:
                raise NoSuchResource("trigram not added to AD group list/No such Domain in inventory", 200)

        """ Verify hostname """
        if not hostname.endswith(".socgen"):
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=500,
                                             response_message="hostname invalid"))
            raise InvalidUsage("hostname invalid. Use FQDN ex: xxx", 500)
        from app.tasks.find_command_IS import find_command_IS
        task =find_command_IS.apply_async(
            kwargs={'hostname': hostname,
                    'action': action['action'].upper(),
                    'IS_name': IS_name},
            expires=datetime.now() + timedelta(minutes=10))
        from app.app_file import redis_cache
        redis_cache.set(task.id, task.status)
        if task.id is not None:
            g.dl_logger.info(
               DatalakeRecord(correlation_id, event="response", response_http_code=202, response_message=task.id,
                              details=task.id))
            return {'hostname': hostname,
                    'trigram': trigram,
                    'Domain_name': domain_name,
                    'Environment': Environment,
                    'IS_name': IS_name,
                    'action': action,
                    'uuid': task.id }, 202
        else:
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=402,
                                             response_message="Something wrong went."))
            return "Something went wrong. Please try it again", 404

    @staticmethod
    def parse_is_action():
        """Get the input to find which IS will be operated"""
        parser = reqparse.RequestParser()
        parser.add_argument("action", type=str)
        return parser.parse_args()

    @staticmethod
    def get_token_info(token):

        """ Return informations from a given token """
        token_info = {"login_ad": token.login_ad(),
                      "mail": token.mail(),
                      "expired": token.is_expired()}
        return token_info

#list repository present in server
@namespace.route("/trigrams/<trigram>/sessions/")
@namespace.param('Domain Host name', 'your domain host name.Give SVCToolname ex: xxx')
@namespace.param('Domain name', 'your domain name. ex: AAA_XXX_X00')
@namespace.param('Environment', 'Your enviornment. ex: Development, Homologation, Production')
#@namespace.param('Repository_name', 'repository name to see list ex: XXX_XXX_X01', required=True)
@namespace.doc(security=[{'oauth2_implicit': ['profile', 'itaas', 'openid']}])
class kill_instance_list(DecoratedResource):
    """List Repository connections"""

    @namespace.doc(description="This function will show repository in server.\n\r"
                               "Please input your respective information according to token.\n\r"
                               "This part should be changed with IAMaaS in the future.")
    # @namespace.param('Domain name', 'your domain ex: AAA_XXX_X00')
    # @namespace.param('Port', 'your host port', optional=True)
    @namespace.response(400, "Invalid Usage - OAuth2.0 Failed")
    @namespace.response(404, "No Such Service")
    @namespace.response(403, "Please verify the domain or contact ETL adm for update the domain list into api")
    def get(self, trigram):
        """get repository present in hostname.
        This endpoint returns repository present in server.
        Endpoint will return according to your token and your account.
        ***The information need for json in the request:***
        * trigram[required]:
            your application trigram.Ex: MAE
        * domain_name:
            domain present in requested server.Ex: AAA_XXX_X00
        * domain_hostname:
            use valid SVCToolname.EX: xxx
        * environment:
            use environment like Development, Homologation and Production.
        <br/><br/>"""
        args = parsetoken()
        hostname = args['Domain Host name']
        domain_name = args['Domain name']
        Environment = args['Environment']
        #repo_name = args['Repository_name'].upper()
        # print(repo_name)
        token_info = self.get_token_info(g.token)
        # cloud_res = check_cloud_permission('A000000')
        cloud_res = check_cloud_permission(token_info['login_ad'])

        """ Exception for E2S: verify the E2S in AD group list and proceed for ansible playbook run  """
        if not tri_search(cloud_res, trigram):
            csv_res = check_csvfile(domain_name.upper(), args['Environment'], cloud_res)
            if not csv_res:
                raise NoSuchResource("trigram not added to AD group list/No such Domain in inventory", 200)
        """ Verify hostname """
        if not hostname.endswith(".socgen"):
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=500,
                                             response_message="hostname invalid"))
            raise InvalidUsage("hostname invalid. Use FQDN ex: xxx", 500)

        from app.tasks.list_repository import list_repository
        task =list_repository.apply_async(
            kwargs={'hostname': hostname},
            expires=datetime.now() + timedelta(minutes=10))
        #print("setting up redis cache")
        from app.app_file import redis_cache
        redis_cache.set(task.id, task.status)
        if task.id is not None:
            g.dl_logger.info(
                DatalakeRecord(correlation_id, event="response", response_http_code=202, response_message=task.id,
                               details=task.id))
            return {'hostname': hostname,
                    'trigram': trigram,
                    'Domain_name': domain_name,
                    'Environment': Environment,
                    'uuid': task.id }, 202
        else:
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=402,
                                             response_message="Something wrong went"))
            return "Something went wrong. Please try it again", 402

    @staticmethod
    def parse_is_action():
        """Get the input to find which IS will be operated"""
        parser = reqparse.RequestParser()
        parser.add_argument("action", type=str)
        return parser.parse_args()

    @staticmethod
    def get_token_info(token):
        """ Return informations from a given token """
        token_info = {"login_ad": token.login_ad(),
                      "mail": token.mail(),
                      "expired": token.is_expired()}
        return token_info

#List repository connection
@namespace.route("/trigrams/<trigram>/sessions/<repo_name>")
@namespace.param('Domain Host name', 'your domain host name.Give SVCToolname ex: xxx')
@namespace.param('Domain name', 'your domain name. ex: AAA_XXX_X00')
@namespace.param('Environment', 'Your enviornment. ex: Development, Homologation, Production')
#@namespace.param('Repository_name', 'repository name to see list ex: XXX_XXX_X01', required=True)
@namespace.doc(security=[{'oauth2_implicit': ['profile', 'itaas', 'openid']}])
class repository_list(DecoratedResource):
    """List Repository connections"""

    @namespace.doc(description="This function will show repository connections list.\n\r"
                               "Please input your respective information according to token.\n\r"
                               "This part should be changed with IAMaaS in the future.")
    # @namespace.param('Domain name', 'your domain ex: AAA_XXX_X00')
    # @namespace.param('Port', 'your host port', optional=True)
    @namespace.response(400, "Invalid Usage - OAuth2.0 Failed")
    @namespace.response(404, "No Such Service")
    @namespace.response(403, "Please verify the domain or contact ETL adm for update the domain list into api")
    def get(self, trigram, repo_name):
        """get your repository connections list.
        This endpoint returns repository connections available to specific repository in server.
        Endpoint will return according to your token and your account.
        ***The information need for json in the request:***
        * trigram[required]:
            your application trigram.Ex: MAE
        * repo name[required]:
            repository name to be listed. Ex: REP_MAE_D01
        * domain_name:
            domain present in requested server.Ex: AAA_XXX_X00
        * domain_hostname:
            use valid SVCToolname.EX: xxx
        * environment:
            use environment like Development, Homologation and Production.
        <br/><br/>"""
        args = parsetoken()
        hostname = args['Domain Host name']
        domain_name = args['Domain name']
        Environment = args['Environment']
        print(hostname, domain_name, Environment, repo_name)
        #repo_name = args['Repository_name'].upper()
        # print(repo_name)
        token_info = self.get_token_info(g.token)
        # cloud_res = check_cloud_permission('A000000')
        cloud_res = check_cloud_permission(token_info['login_ad'])

        """ Exception for E2S: verify the E2S in AD group list and proceed for ansible playbook run  """
        if not tri_search(cloud_res, trigram):
            csv_res = check_csvfile(domain_name.upper(), args['Environment'], cloud_res)
            if not csv_res:
                raise NoSuchResource("trigram not added to AD group list/No such Domain in inventory", 200)
        """ Verify hostname """
        if not hostname.endswith(".socgen"):
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=500,
                                             response_message="hostname invalid"))
            raise InvalidUsage("hostname invalid. Use FQDN ex: xxx", 500)

        from app.tasks.list_repository import list_repo_connection
        task =list_repo_connection.apply_async(
                                      kwargs={'hostname': hostname,
                                              'repo_name': repo_name},
                                      expires=datetime.now() + timedelta(minutes=10))
        from app.app_file import redis_cache
        redis_cache.set(task.id, task.status)
        if task.id is not None:
            g.dl_logger.info(
                DatalakeRecord(correlation_id, event="response", response_http_code=202, response_message=task.id,
                               details=task.id))
            return {'hostname': hostname,
                    'trigram': trigram,
                    'Domain_name': domain_name,
                    'Environment': Environment,
                    'repository_name': repo_name,
                    'uuid': task.id }, 202
        else:
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=402,
                                            response_message="Something wrong went."))
            return "Something went wrong. Please try it again", 402

    @staticmethod
    def parse_is_action():
        """Get the input to find which IS will be operated"""
        parser = reqparse.RequestParser()
        parser.add_argument("action", type=str)
        return parser.parse_args()

    @staticmethod
    def get_token_info(token):
        """ Return informations from a given token """
        token_info = {"login_ad": token.login_ad(),
                      "mail": token.mail(),
                      "expired": token.is_expired()}
        return token_info

#Killsession using username
@namespace.route("/trigrams/<trigram>/sessions/<username>")
@namespace.param('Domain Host name', 'your domain host name.Give SVCToolname ex: xxx')
@namespace.param('Domain name', 'your domain name. ex: AAA_XXX_X00')
@namespace.param('Environment', 'Your enviornment. ex: Development, Homologation, Production')
@namespace.param('Repository_name', 'repository name to see list ex: XXX_XXX_X01', required=True)
@namespace.doc(security=[{'oauth2_implicit': ['profile', 'itaas', 'openid']}])
class kill_instance_user(DecoratedResource):
    """ Run user session using Username"""

    @namespace.doc(description="This function will kill user session using username.\n\r"
                               "Please input your respective information according to token.\n\r"
                               "This part should be changed with IAMaaS in the future.")
    # @namespace.param('Username', 'user name to kill session ex: userID', required=True)
    @namespace.response(400, "Invalid Usage - OAuth2.0 Failed")
    @namespace.response(404, "No Such Service")
    @namespace.response(403, "Please verify the domain or contact ETL adm for update the domain list into api")
    def delete(self, trigram, username):
        """ Kill session using Username.
        This endpoint will kill user session of specific user using username.
        Endpoint will return according to your token and your account.
        ***The information need for json in the request:***
        * trigram[required]:
            your application trigram.Ex: MAE
        * username[required]:
            specific username to kill session. Ex: userID.
        * repo name[required]:
            repository name in server. Ex: REP_MAE_D01
        * domain_name:
            domain present in requested server.Ex: AAA_XXX_X00
        * domain_hostname:
            use valid SVCToolname.EX: xxx
        * environment:
            use environment like Development, Homologation and Production.
        <br/><br/>"""
        args = parsetoken()
        hostname = args['Domain Host name']
        domain_name = args['Domain name']
        repo_name = args['Repository_name'].upper()
        Environment = args['Environment']
        token_info = self.get_token_info(g.token)
        cloud_res = check_cloud_permission(token_info['login_ad'])
        """ Exception for E2S: verify the E2S in AD group list and proceed for ansible playbook run  """
        if not tri_search(cloud_res, trigram):
            csv_res = check_csvfile(domain_name.upper(), args['Environment'], cloud_res)
            if not csv_res:
                raise NoSuchResource("trigram not added to AD group list/No such Domain in inventory", 200)
        """ Verify hostname """
        if not hostname.endswith(".socgen"):
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=500,
                                             response_message="hostname invalid"))
            raise InvalidUsage("hostname invalid. Use FQDN ex: xxx", 500)

        from app.tasks.kill_session import kill_session_user
        task = kill_session_user.apply_async(
            kwargs={'hostname': hostname,
                    'repo_name': repo_name.upper(),
                    'username': username},
            expires=datetime.now() + timedelta(minutes=10))
        print("setting up redis cache")
        from app.app_file import redis_cache
        redis_cache.set(task.id, task.status)
        if task.id is not None:
            g.dl_logger.info(
                DatalakeRecord(correlation_id, event="response", response_http_code=202, response_message=task.id,
                               details=task.id))
            return {'hostname': hostname,
                    'trigram': trigram,
                    'Domain_name': domain_name,
                    'Environment': Environment,
                    'repository_name': repo_name,
                    'username': username,
                    'uuid': task.id }, 202
        else:
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=402,
                                             response_message="Something wrong went."))
            return "Something went wrong. Please try it again", 402

    @staticmethod
    def parse_is_action():
        """Get the input to find which IS will be operated"""
        parser = reqparse.RequestParser()
        parser.add_argument("action", type=str)
        return parser.parse_args()

    @staticmethod
    def get_token_info(token):
        """ Return informations from a given token """
        token_info = {"login_ad": token.login_ad(),
                      "mail": token.mail(),
                      "expired": token.is_expired()}
        return token_info

#Killsession using sessionID
@namespace.route("/trigrams/<trigram>/sessions/<sessionID>")
@namespace.param('Domain Host name', 'your domain host name.Give SVCToolname ex: xxx')
@namespace.param('Domain name', 'your domain name. ex: AAA_XXX_X00')
@namespace.param('Environment', 'Your enviornment. ex: Development, Homologation, Production')
@namespace.param('Repository_name', 'repository name to see list ex: XXX_XXX_X01', required=True)
@namespace.doc(security=[{'oauth2_implicit': ['profile', 'itaas', 'openid']}])
class kill_instance_session(DecoratedResource):
    """ Kill user session using session ID """

    @namespace.doc(description="This function will kill user session using sessionID.\n\r"
                               "Please input your respective information according to token.\n\r"
                               "This part should be changed with IAMaaS in the future.")
    @namespace.response(400, "Invalid Usage - OAuth2.0 Failed")
    @namespace.response(404, "No Such Service")
    @namespace.response(403, "Please verify the domain or contact ETL adm for update the domain list into api")
    def delete(self, trigram, sessionID):
        """ Kill session using session ID.
        This endpoint will kill session using sessionID.
        Endpoint will return according to your token and your account.
        ***The information need for json in the request:***
        * trigram[required]:
            your application trigram.Ex: MAE
        * sessionID[required]:
            specific session identified by sessionID to kill. it should be digit.Ex: 4326.
        * repo name[required]:
            repository name in server. Ex: REP_MAE_D01
        * domain_name:
            domain present in requested server.Ex: AAA_XXX_X00
        * domain_hostname:
            use valid SVCToolname.EX: xxx
        * environment:
            use environment like Development, Homologation and Production.
        <br/><br/>"""
        args = parsetoken()
        hostname = args['Domain Host name']
        domain_name = args['Domain name']
        Environment = args['Environment']
        repo_name = args['Repository_name'].upper()
        #sessionID = args['SessionID']
        if not sessionID.isdigit():
            raise NoSuchResource("sessionID is not valid. try listing session to get valid sessionID", 403)
        token_info = self.get_token_info(g.token)
        cloud_res = check_cloud_permission(token_info['login_ad'])

        """ Exception for E2S: verify the E2S in AD group list and proceed for ansible playbook run  """
        if not tri_search(cloud_res, trigram):
            csv_res = check_csvfile(domain_name.upper(), args['Environment'], cloud_res)
            if not csv_res:
                raise NoSuchResource("trigram not added to AD group list/No such Domain in inventory", 200)
        """ Verify hostname """
        if not hostname.endswith(".socgen"):
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=500,
                                             response_message="hostname invalid"))
            raise InvalidUsage("hostname invalid. Use FQDN ex: xxx", 500)

        from app.tasks.kill_session import run_killsession_sessionID
        task =run_killsession_sessionID.apply_async(
            kwargs={'hostname': hostname,
                    'repo_name': repo_name.upper(),
                    'sessionID': sessionID},
            expires=datetime.now() + timedelta(minutes=10))
        from app.app_file import redis_cache
        redis_cache.set(task.id, task.status)
        if task.id is not None:
            g.dl_logger.info(
                DatalakeRecord(correlation_id, event="response", response_http_code=202, response_message=task.id,
                               details=task.id))
            return {'hostname': hostname,
                    'trigram': trigram,
                    'Domain_name': domain_name,
                    'Environment': Environment,
                    'repository_name': repo_name,
                    'sessionID': sessionID,
                    'uuid': task.id }, 202
        else:
            g.dl_logger.error(DatalakeRecord(correlation_id, event="response", response_http_code=402,
                                             response_message="Something wrong went."))
            return "Something went wrong. Please try it again", 402

    @staticmethod
    def parse_is_action():
        """Get the input to find which IS will be operated"""
        parser = reqparse.RequestParser()
        parser.add_argument("action", type=str)
        return parser.parse_args()

    @staticmethod
    def get_token_info(token):
        """ Return informations from a given token """
        token_info = {"login_ad": token.login_ad(),
                      "mail": token.mail(),
                      "expired": token.is_expired()}
        return token_info

""" tri_search() function returns True only when
trigram entered in API is in ADGroup list of client id.
input: cloud_res, trigram
output: True/False"""
def tri_search(cloud_res, trigram):
    for i in range(len(cloud_res)):
        if cloud_res[i][1] == trigram:
            return True
    return False

def parsetoken():
    """
    Function : simulate the response from account as a service
    :param application: your [TRI]+[IRT]
    :param region: your region(zone )
    :param environment: your [TRI]+[IRT]
    :return: a dict contains the account information
    """
    parser = reqparse.RequestParser()
    parser.add_argument("application", type=str)
    parser.add_argument("region", type=str)
    parser.add_argument('Environment', type=str)
    parser.add_argument('IS_name', type=str)
    parser.add_argument('Domain Host name', type=str)
    parser.add_argument('Domain name', type=str)
    parser.add_argument('Repository_name', type=str)
    parser.add_argument('SessionID', type=int)
    return parser.parse_args()
```

## Swagger SG

API doit etre conform au norm API chez Societe Generale

on s'installe le swagger submodule de la SG

```bash
git submodule add -b templates https://xxxxxx/BeAPI/sg-swagger-ui.git swagger
```

client id doit etre creer manuellement via SG API market, en suite, on aura client name avec le client id:

```bash
export SWAGGER_UI_OAUTH_REALM='/'
export SWAGGER_UI_OAUTH_APP_NAME='itaas'
export SWAGGER_UI_OAUTH_CLIENT_ID='xxxxxxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
```

## RUN

Cette application utilise le user generique afin de deployer l'API, assure que les variables environnement sont bien rempli sur `dev-env.sh` ou `prd-env.sh`

```bash
export USER="identification"
export PASSWORD="password"
```

```bash
gunicorn manage:app -c config/gunicorn_conf.py --timeout 350 --certfile=ssl/xxx.crt --keyfile=ssl/xxx.key &
```

pour lancer le celery worker:

```bash
celery flower -A app.celery worker1 --concurrency=2 --loglevel=INFO --port=5555 &
```

## DEPLOY

On a utilise secrets service in kubernetes pour la partie SSL et les variables environnements.

```bash
kubectl create -f /code/ETLaaS_GCR_async/kube/secret-env.yml --namespace ns-xxx-xxxxx-dev-ssa
```

Docker local:

```yml
version: '3.1'
services:
  celery_worker:
    image: etlaas:${BUILD_NUMBER}
    depends_on:
      - redis-master
    command: bash -c "./celery_start.sh; sleep 2; tail -f /code/ETLaaS_GCR_async/error.log"
    networks:
      - network-l7-e2s-dev
    deploy:
      replicas: 2
      labels:
        - 'com.docker.ucp.access.label=/Run/xxxx'
        - 'com.docker.ucp.access.owner=xxxx'
    environment:
      - DNSNAME=xxxx
    env_file:
      - run/dev-env.sh
    secrets:
      - source: xxxx.crt
        target: xxxx.crt
        mode: 0777
      - source: xxxx.key
        target: xxxx.key
        mode: 0777
      - source: e2s_vault_write_token
        target: e2s_vault_write_token
        mode: 0777
      - source: e2s-dev-write-consul-ACL
        target: e2s-dev-write-consul-ACL
        mode: 0777
      - source: LDAP_LOGIN
        target: LDAP_LOGIN
        mode: 0777
      - source: LDAP_PASSWORD
        target: LDAP_PASSWORD
        mode: 0777
      - source: private_key
        target: private_key
        uid: '1000'
        gid: '1000'
        mode: 0600

  api:
    image: etlaas:${BUILD_NUMBER}
    depends_on:
      - redis-master
      - celery_worker
    command: bash -c "./startup.sh; sleep 3; tail -f /code/ETLaaS_GCR_async/error.log"
    networks:
      - network-l7-e2s-dev
    deploy:
      replicas: 2
      labels:
        - 'com.docker.ucp.access.label=/Run/xxxx'
        - 'com.docker.ucp.access.owner=xxxx'
    environment:
      - DNSNAME=etlaas-gcr

    env_file:
      - run/dev-env.sh
    secrets:
      - source: xxxx.crt
        target: xxxx.crt
        mode: 0777
      - source: xxxx.key
        target: xxxx.key
        mode: 0777
      - source: e2s_vault_write_token
        target: e2s_vault_write_token
        mode: 0777
      - source: e2s-dev-write-consul-ACL
        target: e2s-dev-write-consul-ACL
        mode: 0777
      - source: LDAP_LOGIN
        target: LDAP_LOGIN
        mode: 0777
      - source: LDAP_PASSWORD
        target: LDAP_PASSWORD
        mode: 0777
      - source: private_key
        target: private_key
        uid: '1000'
        gid: '1000'
        mode: 0600

networks:
  network-l7-e2s-dev:
    external: true

secrets:
  xxxx.crt:
    external: true
  xxxx.key:
    external: true
  e2s_vault_write_token:
    external: true
  e2s-dev-write-consul-ACL:
    external: true
  LDAP_LOGIN:
    external: true
  LDAP_PASSWORD:
    external: true
  private_key:
    external: true
```

Kubernetes:

```bash
#kube-deploy.sh
#redis deployment
./kubectl create -f kube/redis/redis-deployment.yml --namespace ns-xxx-dev-ssa
#redis service
./kubectl create -f kube/redis/redis-svc.yml --namespace ns-xxx-dev-ssa
#celery deployment
./kubectl create -f kube/redis/celery-deployment.yml --namespace ns-xxx-dev-ssa
#celery service
./kubectl create -f kube/redis/celery-svc.yml --namespace ns-xxx-dev-ssa
#application deployment
./kubectl create -f kube/etlaas-deployment.yml --namespace ns-xxx-dev-ssa
#application service
./kubectl create -f kube/etlaas-svc.yml --namespace ns-xxx-dev-ssa
#application ingress
./kubectl create -f kube/etlaas-ingress.yml --namespace ns-xxx-dev-ssa
```

# CICD

Pour la partie CICD, l'implementation de scripts Jenkinsfile sur Jenkins Instance avec le webhook de pull-resquest sur le repository

```groovy
// Jenkinfile
dockerNode(image: 'maven-ezweb-builder:3.3.9-jdk-1.8.0.121-node-9.5.0') {
//Environment properties to build and releae application modules
withEnv(['DOCKER_HOST=tcp://xxx:443',
         'UCP_URL=https://xxx',
	 'DOCKER_TLS_VERIFY=1',
	 'DOCKER_CERT_PATH=/home/jenkins',
	 'UCP_credentialsId=UCP_Credentials']) {

//Credentials to connect with docker services
withCredentials([[$class: 'UsernamePasswordMultiBinding',
		credentialsId: "$UCP_credentialsId",
		usernameVariable: 'USER',
		passwordVariable: 'PASSWORD']]) {
		    withCredentials([file(credentialsId: 'e2s_dev_svc-kube.yml', variable: 'KUBECONFIG')]){
//fetching ucp certs for deployments
	sh '''AUTHTOKEN=$(curl -sk -d "{\\"username\\":\\"$USER\\",\\"password\\":\\"$PASSWORD\\"}" $UCP_URL/auth/login | jq -r .auth_token)
    	curl -k -H "Authorization: Bearer $AUTHTOKEN" $UCP_URL/api/clientbundle -o $HOME/bundle.zip
    	unzip -o $HOME/bundle.zip -d $HOME'''
    	sh 'docker login --username=$USER  --password=$PASSWORD https://xxxx/'

stage('GIT-CLONE') {
    	git changelog: false, poll: false, url: 'https://xxx/GTS-PAS-MDW-APP/ETLaaS_GCR_async.git'
		  env.GIT_COMMIT = sh(script: "git rev-parse HEAD", returnStdout: true).trim()
	}
stage('BUILD_IMAGE') {
        sh """docker build -f dockers/ETLaaS_async/Dockerfile --tag etlaas:etlaas-kube --force-rm --no-cache .; docker push etlaas:etlaas-kube"""

    }
stage('KUBECTL') {
        sh """curl -k -L http://xxxx/eservices/sources/docker-client/kubectl-1.8.zip -o /home/jenkins/.jenkins/workspace/kube_etl/kubectl.zip && unzip -o /home/jenkins/.jenkins/workspace/kube_etl/kubectl.zip && chmod +x ./kubectl"""
}
stage('KUBE_DEPLOY') {
        sh '''sh kube/kube-deploy.sh '''
}
		    }
	}	}
}
```
