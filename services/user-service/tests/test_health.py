from django.test import SimpleTestCase


class HealthTests(SimpleTestCase):
    def test_health(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["service"], "user-service")
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_health_rejects_post(self):
        response = self.client.post("/health")

        self.assertEqual(response.status_code, 405)
        self.assertEqual(response["Allow"], "GET")
