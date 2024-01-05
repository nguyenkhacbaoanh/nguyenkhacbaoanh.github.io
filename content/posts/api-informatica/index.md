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

Some examples of Api methods

```python informatica.py
.grid__item {
  &:hover,
  &:focus-within {
    background-color: #eee;
  }

  a {
    position: relative;
    z-index: 1;
  }

  h2 {
    a {
      position: static;

      &:hover,
      &:focus {
        color: blue;
      }

      &:before {
        content: '';
        display: block;
        position: absolute;
        z-index: 0;
        width: 100%;
        height: 100%;
        top: 0;
        left: 0;
        transition: background-color 0.1s ease-out;
        background-color: transparent;
      }
    }
  }
}
```
