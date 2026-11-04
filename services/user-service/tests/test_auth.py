from django.test import SimpleTestCase

from user_service.auth import inject_identity_headers, parse_groups


class AuthInjectionTests(SimpleTestCase):
    def test_injects_claims_and_strips_spoofed_headers(self):
        event = {
            "headers": {
                "content-type": "application/json",
                "x-auth-sub": "spoofed",
                "X-Auth-Token-Use": "spoofed",
            },
            "requestContext": {
                "authorizer": {
                    "jwt": {
                        "claims": {
                            "sub": "user-1",
                            "username": "user@example.com",
                            "email": "user@example.com",
                            "cognito:groups": "admins",
                            "token_use": "access",
                        }
                    }
                }
            },
        }

        inject_identity_headers(event)
        headers = event["headers"]

        self.assertEqual(headers["X-Auth-Sub"], "user-1")
        self.assertEqual(headers["X-Auth-Email"], "user@example.com")
        self.assertEqual(headers["X-Auth-Username"], "user@example.com")
        self.assertEqual(headers["X-Auth-Groups"], "admins")
        self.assertEqual(headers["X-Auth-Token-Use"], "access")
        self.assertNotIn("x-auth-sub", headers)
        self.assertNotIn("x-auth-token-use", headers)

    def test_removes_spoofed_headers_when_no_claims(self):
        event = {
            "headers": {
                "x-auth-sub": "spoofed",
                "Content-Type": "application/json",
            }
        }

        inject_identity_headers(event)

        self.assertEqual(event["headers"], {"Content-Type": "application/json"})

    def test_parse_groups_formats(self):
        self.assertEqual(parse_groups("admins"), ("admins",))
        self.assertEqual(parse_groups("[admins]"), ("admins",))
        self.assertEqual(parse_groups('["admins"]'), ("admins",))
        self.assertEqual(parse_groups("[admins,customers]"), ("admins", "customers"))
        self.assertEqual(parse_groups("admins,customers"), ("admins", "customers"))
        self.assertEqual(parse_groups(""), ())
