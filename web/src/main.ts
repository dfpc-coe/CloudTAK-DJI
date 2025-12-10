import { createApp } from 'vue'
import * as VueRouter from 'vue-router'
import App from './App.vue'

// Intentially not dynamic import to ensure it's included in the build
// It contains a utility to hard reload the app
import Login from './components/Login.vue'

const router = VueRouter.createRouter({
    history: VueRouter.createWebHistory(),
    routes: [
        {
            path: '/',
            name: 'home',
            component: () => import('./components/Home.vue'),
        },

        { path: '/login', name: 'login', component: Login },

        { path: '/:catchAll(.*)', name: 'lost', component: () => import('./components/LostUser.vue') },
    ]
});

const app = createApp(App);

app.use(router);

app.mount('#app');
