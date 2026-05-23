import AdminJS, { ComponentLoader } from 'adminjs';
console.log('admin.js: loading AdminJS config');
import AdminJSExpress from '@adminjs/express';
import AdminJSSequelize from '@adminjs/sequelize';
import uploadFeature from '@adminjs/upload';
import { LocalProvider } from '@adminjs/upload';
import CustomLocalProvider from './custom-local-provider.js';
import { User, Project, Team, Client, Testimonial, ProjectCategory, CmsTable, Service, AboutUs, Award, Contact, Task, Cost, ProjectImage, CmsTableImage, SentEmail, ProjectURL } from '../models/index.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

AdminJS.registerAdapter(AdminJSSequelize);

const componentLoader = new ComponentLoader();

// Flag to ensure upload UI components are bundled only once.
// Multiple calls to the upload feature (one per resource) can attempt to
// register the same component names repeatedly which causes ComponentLoader
// to throw. We detect whether the frontend bundle already contains the
// upload components (in `.adminjs/entry.js`) and, if so, use a shim loader
// that returns component names instead of attempting to register them.
let uploadComponentsBundled = false;
const UPLOAD_COMPONENTS_DIR = path.resolve(__dirname, '../../node_modules/@adminjs/upload/build/features/upload-file/components');
const ADMIN_ENTRY_PATH = path.resolve(__dirname, '../../.adminjs/entry.js');

const isPrebundled = (() => {
  try {
    if (fs.existsSync(ADMIN_ENTRY_PATH)) {
      const content = fs.readFileSync(ADMIN_ENTRY_PATH, 'utf8');
      return content.includes('UploadEditComponent');
    }
  } catch (e) {
    // ignore
  }
  return false;
})();

const shimLoader = {
  add: (name) => name,
  override: (name) => name,
};

const getLoader = () => {
  if (isPrebundled) return shimLoader;
  // If components have already been registered on the real loader,
  // use the shim to avoid calling add() again inside the upload package.
  if (uploadComponentsBundled) return shimLoader;
  return componentLoader;
};

// Navigation Dashboard Component
const NAVIGATION_DASHBOARD_PATH = path.resolve(__dirname, '../components/NavigationDashboard.jsx');
componentLoader.add('NavigationDashboard', NAVIGATION_DASHBOARD_PATH);
componentLoader.add('EmailDashboard', path.resolve(__dirname, '../components/EmailDashboard.jsx'));

// Common actions configuration for Drawer Mode
const drawerActions = {
  edit: { showInDrawer: true },
  show: { showInDrawer: true },
  delete: { showInDrawer: true },
  new: { showInDrawer: true }
};

// Helper for local upload feature - Requires componentLoader in v7+
// Wrap creation so that if @adminjs/upload throws "already defined" we
// override the existing components and retry. This avoids startup
// failures when the same component names were registered earlier
// (different load order between environments).
const localUploadFeature = (properties) => {
  const featureOptions = {
    // Use a custom provider that handles cross-device moves (EXDEV) by
    // falling back to copy+unlink. We instantiate as a `base` provider so
    // the upload package will accept it directly.
    provider: { base: new CustomLocalProvider({ bucket: 'public/uploads', opts: { baseUrl: '/uploads' } }) },
    properties: properties,
    validation: { mimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] }
  };

  // Select loader. If there is no prebundle and components haven't been
  // registered yet, we will register them on the real ComponentLoader and
  // then use the shim for the upload feature to avoid duplicate add() calls.
  let loader = getLoader();

  if (loader === componentLoader && !uploadComponentsBundled) {
    const editPath = path.join(UPLOAD_COMPONENTS_DIR, 'UploadEditComponent.js');
    const listPath = path.join(UPLOAD_COMPONENTS_DIR, 'UploadListComponent.js');
    const showPath = path.join(UPLOAD_COMPONENTS_DIR, 'UploadShowComponent.js');
    try {
      componentLoader.add('UploadEditComponent', editPath);
      componentLoader.add('UploadListComponent', listPath);
      componentLoader.add('UploadShowComponent', showPath);
      uploadComponentsBundled = true;
      // After registering on the real loader, switch to shim so the upload
      // package's bundleComponent() calls don't try to add again.
      loader = shimLoader;
    } catch (addErr) {
      if (addErr && addErr.message && addErr.message.includes('already defined')) {
        try {
          if (typeof componentLoader.override === 'function') {
            componentLoader.override('UploadEditComponent', editPath);
            componentLoader.override('UploadListComponent', listPath);
            componentLoader.override('UploadShowComponent', showPath);
            uploadComponentsBundled = true;
            loader = shimLoader;
          }
        } catch (ovErr) {
          console.warn('Failed to override upload components during registration:', ovErr);
        }
      } else {
        throw addErr;
      }
    }
  }

  return uploadFeature({ ...featureOptions, componentLoader: loader });
};


// Helper to verify Django password (reused from authController logic)
const verifyDjangoPassword = (password, storedHash) => {
  const parts = storedHash.split('$');
  if (parts.length !== 4) return false;
  const algorithm = parts[0];
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const hash = parts[3];
  if (algorithm !== 'pbkdf2_sha256') return false;
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return key.toString('base64') === hash;
};

// Hook to process multiple images uploaded to Project
const processProjectImages = async (response, request, context) => {
  const { record } = response;
  
  if (record && record.params && record.params.uploaded_images_cache) {
    const images = record.params.uploaded_images_cache;
    // Handle both single string (if 1 file) or array
    const imagePaths = Array.isArray(images) ? images : [images];

    for (const imagePath of imagePaths) {
      if (imagePath) {
        await ProjectImage.create({
          project_id: record.id,
          image: imagePath,
          uploadedFile: imagePath // redundant but safe if key varies
        });
      }
    }
  }
  return response;
  return response;
};

// Hook to process multiple images uploaded to CmsTable
const processCmsTableImages = async (response, request, context) => {
  const { record } = response;
  
  if (record && record.params && record.params.uploaded_images_cache) {
    const images = record.params.uploaded_images_cache;
    const imagePaths = Array.isArray(images) ? images : [images];

    for (const imagePath of imagePaths) {
      if (imagePath) {
        await CmsTableImage.create({
          cmstable_id: record.id,
          image: imagePath,
          uploadedFile: imagePath
        });
      }
    }
  }
  return response;
};

const adminJs = new AdminJS({
  componentLoader,
  databases: [], // We use resources instead
  dashboard: {
    component: 'NavigationDashboard'
  },
  pages: {
    Email: {
      label: 'Email Interface',
      component: 'EmailDashboard',
      icon: 'Mail',
      navigation: { name: 'Communications', icon: 'Mail' }
    }
  },
  resources: [
    { 
      resource: User, 
      options: { 
        id: 'auth_user',
        label: 'Users',
        navigation: { name: 'User Management', icon: 'User' },
        listProperties: ['email', 'username', 'role', 'is_active', 'is_staff'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          email: { isTitle: true, position: 1 },
          username: { position: 2 },
          role: { position: 3 },
          is_active: { position: 4 },
          is_staff: { position: 5 },
          password: { isVisible: { list: false, show: false, edit: true, filter: false }, type: 'password' },
          first_name: { isVisible: { list: false, show: true, edit: true, filter: false } },
          last_name: { isVisible: { list: false, show: true, edit: true, filter: false } },
        },
      } 
    },
    { 
      resource: Project, 
      options: { 
        id: 'api_project',
        label: 'Projects',
        navigation: { name: 'Projects', icon: 'Folder' },
        listProperties: ['title', 'slug', 'start_date', 'end_date', 'is_completed'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          title: { isTitle: true, position: 1 },
          slug: { position: 2, isVisible: { list: true, show: true, edit: false, filter: true, new: false } },
          description: { 
            type: 'richtext',
            isVisible: { list: false, show: true, edit: true, filter: false }
          },
          start_date: { position: 3, type: 'date' },
          end_date: { position: 4, type: 'date' },
          is_completed: { position: 5 },
          cost_estimation: { position: 6 },
          client_id: { isVisible: { list: false, show: true, edit: true, filter: true }, resourceId: 'api_client' },
          category_id: { isVisible: { list: false, show: true, edit: true, filter: true }, resourceId: 'api_projectcategory' },
          // Reference to ProjectImages
          // Reference to ProjectImages
          images: {
            isVisible: { list: false, show: true, edit: true, filter: false },
            position: 10
          },
          // Partial for Multi-Upload
          uploaded_images_cache: { isVisible: false },
          new_images: { isVisible: { list: false, show: false, edit: true, filter: false }, position: 11 }
        },
        actions: {
          ...drawerActions,
          new: { ...drawerActions.new, after: processProjectImages },
          edit: { ...drawerActions.edit, after: processProjectImages }
        },
      },
      features: [
        localUploadFeature({ 
          key: 'uploaded_images_cache', 
          file: 'new_images',
          multiple: true
        })
      ] 
    },
    { 
      resource: Team, 
      options: { 
        id: 'api_team',
        label: 'Team Members',
        navigation: { name: 'Company', icon: 'Users' },
        listProperties: ['uploadedImage', 'name', 'designation', 'email', 'phone_number'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          image: { isVisible: false }, // Handled by upload feature
          uploadedImage: { isVisible: { list: true, show: true, edit: true, filter: false }, position: 1 },
          name: { isTitle: true, position: 2 },
          designation: { position: 3 },
          email: { position: 4, type: 'email' },
          phone_number: { position: 5 },
          qualification: { isVisible: { list: false, show: true, edit: true, filter: false } }
        },
        actions: drawerActions,
      },
      features: [localUploadFeature({ key: 'image', file: 'uploadedImage' })]
    },
    { 
      resource: Client, 
      options: { 
        id: 'api_client',
        label: 'Clients',
        navigation: { name: 'Company', icon: 'Briefcase' },
        listProperties: ['logo', 'name', 'email', 'phone'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          logo: { isVisible: false },
          uploadedLogo: { isVisible: { list: true, show: true, edit: true, filter: false }, position: 1 },
          name: { isTitle: true, position: 2 },
          email: { position: 3, type: 'email' },
          phone: { position: 4 }
        },
        actions: drawerActions,
      },
      features: [localUploadFeature({ key: 'logo', file: 'uploadedLogo' })]
    },
    { 
      resource: Testimonial, 
      options: { 
        id: 'api_testimonial',
        label: 'Testimonials',
        navigation: { name: 'Company', icon: 'MessageSquare' },
        listProperties: ['photo', 'name', 'role', 'created_at'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          photo: { isVisible: false },
          uploadedPhoto: { isVisible: { list: true, show: true, edit: true, filter: false }, position: 1 },
          name: { isTitle: true, position: 2 },
          role: { position: 3 },
          testimonial: { 
            type: 'richtext',
            isVisible: { list: false, show: true, edit: true, filter: false }
          },
          created_at: { position: 4, type: 'datetime' }
        },
        actions: drawerActions,
      },
      features: [localUploadFeature({ key: 'photo', file: 'uploadedPhoto' })]
    },
    { 
      resource: ProjectCategory, 
      options: { 
        id: 'api_projectcategory',
        label: 'Categories',
        navigation: { name: 'Projects', icon: 'Tag' },
        listProperties: ['name', 'slug', 'parent_id'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          name: { isTitle: true, position: 1 },
          slug: { position: 2, isVisible: { list: true, show: true, edit: false, filter: true, new: false } },
          parent_id: { position: 3, resourceId: 'api_projectcategory' }
        },
        actions: drawerActions,
      } 
    },
    { 
      resource: CmsTable, 
      options: { 
        id: 'api_cmstable',
        label: 'CMS Tables',
        navigation: { name: 'Content', icon: 'FileText' },
        listProperties: ['title', 'slug', 'created_at'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          title: { isTitle: true, position: 1 },
          slug: { position: 2 },
          description: { 
            type: 'richtext',
            isVisible: { list: false, show: true, edit: true, filter: false }
          },
          created_at: { position: 3, type: 'datetime' },
          image: { isVisible: { list: false, show: true, edit: true, filter: false } },
          // Reference to CmsTableImages
          images: {
            isVisible: { list: false, show: true, edit: true, filter: false },
            position: 10
          },
          // Partial for Multi-Upload
          uploaded_images_cache: { isVisible: false },
          new_images: { isVisible: { list: false, show: false, edit: true, filter: false }, position: 11 }
        },
        actions: {
          ...drawerActions,
          new: { ...drawerActions.new, after: processCmsTableImages },
          edit: { ...drawerActions.edit, after: processCmsTableImages }
        },
      },
      features: [
        localUploadFeature({ 
          key: 'uploaded_images_cache', 
          file: 'new_images',
          multiple: true
        })
      ] 
    },
    { 
      resource: Service, 
      options: { 
        id: 'api_service',
        label: 'Services',
        navigation: { name: 'Content', icon: 'Box' },
        listProperties: ['image', 'title', 'slug', 'created_at'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          image: { isVisible: false },
          uploadedImage: { isVisible: { list: true, show: true, edit: true, filter: false }, position: 1 },
          title: { isTitle: true, position: 2 },
          slug: { position: 3 },
          description: { 
            type: 'richtext',
            isVisible: { list: false, show: true, edit: true, filter: false }
          },
          created_at: { position: 4, type: 'datetime' }
        },
        actions: drawerActions,
      },
      features: [localUploadFeature({ key: 'image', file: 'uploadedImage' })]
    },
    { 
      resource: AboutUs, 
      options: { 
        id: 'api_aboutus',
        label: 'About Us',
        navigation: { name: 'Content', icon: 'Info' },
        listProperties: ['title', 'slug', 'created_at'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          title: { isTitle: true, position: 1 },
          slug: { position: 2 },
          description: { 
            type: 'richtext',
            isVisible: { list: false, show: true, edit: true, filter: false }
          },
          created_at: { position: 3, type: 'datetime' }
        },
        actions: drawerActions,
      } 
    },
    { 
      resource: Award, 
      options: { 
        id: 'api_award',
        label: 'Awards',
        navigation: { name: 'Company', icon: 'Award' },
        listProperties: ['image', 'title', 'date', 'awarded_by', 'venue'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          image: { isVisible: false },
          uploadedImage: { isVisible: { list: true, show: true, edit: true, filter: false }, position: 1 },
          title: { isTitle: true, position: 2 },
          date: { position: 3, type: 'date' },
          awarded_by: { position: 4 },
          venue: { position: 5 },
          description: { 
            type: 'richtext',
            isVisible: { list: false, show: true, edit: true, filter: false }
          },
          project_id: { resourceId: 'api_project' }
        },
        actions: drawerActions,
      },
      features: [localUploadFeature({ key: 'image', file: 'uploadedImage' })] 
    },
    { 
      resource: Contact, 
      options: { 
        id: 'api_contact',
        label: 'Contact Inquiries',
        navigation: { name: 'Communications', icon: 'Mail' },
        listProperties: ['email', 'name', 'phone_number', 'created_at'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          email: { isTitle: true, position: 1, type: 'email' },
          name: { position: 2 },
          phone_number: { position: 3 },
          message: { 
            type: 'richtext',
            isVisible: { list: false, show: true, edit: false, filter: false }
          },
          created_at: { position: 4, type: 'datetime' }
        },
        actions: drawerActions,
      } 
    },
    { 
      resource: Task, 
      options: { 
        id: 'api_task',
        label: 'Project Tasks',
        navigation: { name: 'Projects', icon: 'CheckSquare' },
        listProperties: ['name', 'project_id', 'created_at'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          name: { isTitle: true, position: 1 },
          project_id: { position: 2, resourceId: 'api_project' },
          description: { 
            type: 'richtext',
            isVisible: { list: false, show: true, edit: true, filter: false }
          },
          created_at: { position: 3, type: 'datetime' }
        },
        actions: drawerActions,
      } 
    },
    { 
      resource: Cost, 
      options: { 
        id: 'api_cost',
        label: 'Project Costs',
        navigation: { name: 'Projects', icon: 'DollarSign' },
        listProperties: ['name', 'amount', 'project_id'],
        properties: { 
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          name: { isTitle: true, position: 1 },
          amount: { position: 2, type: 'currency' },
          project_id: { position: 3, resourceId: 'api_project' },
          description: { 
            type: 'richtext',
            isVisible: { list: false, show: true, edit: true, filter: false }
          }
        },
        actions: drawerActions,
      } 
    },
    { 
      resource: ProjectImage, 
      options: { 
        id: 'api_projectimage',
        label: 'Project Photos',
        navigation: { name: 'Projects', icon: 'Image' },
        listProperties: ['uploadedFile', 'project_id', 'created_at'],
        properties: {
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          image: { isVisible: false },
          uploadedFile: { isVisible: { list: true, show: true, edit: true, filter: false }, position: 1 },
          project_id: { position: 2, resourceId: 'api_project' },
          created_at: { position: 3, type: 'datetime' }
        },
        actions: drawerActions,
      },
      features: [localUploadFeature({ key: 'image', file: 'uploadedFile' })]
    },
    { 
      resource: CmsTableImage, 
      options: { 
        id: 'api_cmstableimage',
        label: 'CMS Table Photos',
        navigation: { name: 'Content', icon: 'Image' },
        listProperties: ['uploadedFile', 'cmstable_id', 'order'],
        properties: {
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          image: { isVisible: false }, // Handled by upload feature
          uploadedFile: { isVisible: { list: true, show: true, edit: true, filter: false }, position: 1 },
          cmstable_id: { position: 2, resourceId: 'api_cmstable' },
          order: { position: 3 }
        },
        actions: drawerActions,
      },
      features: [localUploadFeature({ key: 'image', file: 'uploadedFile' })]
    },
    { 
      resource: SentEmail, 
      options: { 
        id: 'api_sentemail',
        label: 'Sent Email Logs',
        navigation: { name: 'Communications', icon: 'Mail' },
        listProperties: ['to', 'subject', 'type', 'created_at'],
        properties: {
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          body: { type: 'textarea', isVisible: { list: false, show: true, edit: false, filter: false } }
        },
        actions: {
          ...drawerActions,
          new: { isVisible: false }
        }
      }
    },
    { 
      resource: ProjectURL, 
      options: { 
        id: 'api_projecturl',
        label: 'Project URLs',
        navigation: { name: 'Projects', icon: 'Link' },
        listProperties: ['url', 'project_id'],
        properties: {
          id: { isVisible: { list: false, show: true, edit: false, filter: true } },
          project_id: { resourceId: 'api_project' }
        },
        actions: drawerActions,
      }
    }
  ],
  rootPath: '/admin',
  branding: {
    companyName: 'Jobo',
    softwareBrothers: false,
    withMadeWithLove: false,
    logo: false, // Hide the default AdminJS logo image
  },
  assets: {
    styles: [
      "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
    ], 
    scripts: [] 
  },
  locale: {
    translations: {
      en: {
        resources: {
          auth_user: { label: 'Users' },
          api_project: { label: 'Projects' },
          api_team: { label: 'Team Members' },
          api_client: { label: 'Clients' },
          api_testimonial: { label: 'Testimonials' },
          api_projectcategory: { label: 'Categories' },
          api_cmstable: { label: 'CMS Tables' },
          api_service: { label: 'Services' },
          api_aboutus: { label: 'About Us' },
          api_award: { label: 'Awards' },
          api_contact: { label: 'Contact Inquiries' },
          api_task: { label: 'Project Tasks' },
          api_cost: { label: 'Project Costs' },
          api_projectimage: { label: 'Project Photos' },
          api_cmstableimage: { label: 'CMS Table Photos' },
          api_projecturl: { label: 'Project URLs' },
          api_sentemail: { label: 'Sent Email Logs' }
        },
        labels: {
          navigation: 'APIs',
          pages: 'Admin Pages',
        },
        messages: {
           navigation: 'APIs',
        },
        actions: {
          bulkDelete: 'Delete Selected',
        },
        buttons: {
          filter: 'Filter Projects'
        }
      }
    },
  },
});

import session from 'express-session';
import connectSequelize from 'connect-session-sequelize';
import sequelize from './database.js'; // Import sequelize instance

const SequelizeStore = connectSequelize(session.Store);

const sessionStore = new SequelizeStore({
  db: sequelize,
});

const adminRouter = AdminJSExpress.buildAuthenticatedRouter(adminJs, {
  authenticate: async (email, password) => {
    try {
      const user = await User.findOne({ 
        where: { email: email } 
      }) || await User.findOne({ where: { username: email } });

      if (user) {
        let isMatch = false;
        if (user.password.startsWith('pbkdf2_sha256$')) {
            isMatch = verifyDjangoPassword(password, user.password);
        } else {
            isMatch = await bcrypt.compare(password, user.password);
        }

        if (isMatch) {
            if (user.is_staff || user.is_superuser || user.role === 'admin' || user.role === 'staff') {
                 return user;
            }
        }
      }
      return false;
    } catch (e) {
        console.error(e);
        return false;
    }
  },
  cookiePassword: 'super-secret-cookie-password-replace-this',
  cookieName: 'adminjs',
}, null, {
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  secret: 'super-secret-session-key'
});

// Sync the session store table
sessionStore.sync();

export { adminJs, adminRouter };
